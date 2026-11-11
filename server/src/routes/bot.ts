import { Elysia, t } from 'elysia'
import { eq } from 'drizzle-orm'
import { authJwt } from '../auth/jwt'
import { db } from '../db'
import { users } from '../db/schema'
import { analyze, BotError, readTrainingGame } from '../bot/engine'
import { teachingContext, explainWithOpenAI, answerQuestion } from '../bot/coach'
import { chooseLesson, recommendationCard } from '../bot/lessons'

export function createBotRoutes(options: {
  accountExists?: (id: string) => Promise<boolean>; engine?: typeof analyze; explain?: typeof explainWithOpenAI; chat?: typeof answerQuestion; now?: () => number
} = {}) {
  const engine = options.engine ?? analyze, explain = options.explain ?? explainWithOpenAI, now = options.now ?? Date.now
  const buckets = new Map<string, { start: number; moves: number; coach: number }>()
  const cache = new Map<string, { until: number; value: Awaited<ReturnType<typeof explainWithOpenAI>> & { fen: string; suggestedMove: string | null } }>()
  const pending = new Set<string>()
  const chat = options.chat ?? answerQuestion
  const accountExists = options.accountExists ?? (async id => !!(await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1))[0])
  function consume(id: string, kind: 'moves' | 'coach') {
    for (const [key, value] of buckets) if (now() - value.start >= 60000) buckets.delete(key)
    const bucket = buckets.get(id) ?? { start: now(), moves: 0, coach: 0 }
    if (buckets.size >= 1000 && !buckets.has(id)) throw new BotError(429, 'Training is busy. Please retry later.')
    if (bucket[kind] >= (kind === 'coach' ? 8 : 40)) throw new BotError(429, kind === 'coach' ? 'Give your coach a moment. Try again next minute.' : 'Too many engine requests. Try again next minute.')
    bucket[kind]++; buckets.set(id, bucket)
  }
  const positionBody = { pgn: t.String({ maxLength: 24000 }), playerColor: t.Union([t.Literal('w'), t.Literal('b')]) }
  return new Elysia({ prefix: '/bot' }).use(authJwt).derive(async ({ headers, jwt }) => {
    const token = headers.authorization?.startsWith('Bearer ') ? headers.authorization.slice(7) : undefined
    const payload = await jwt.verify(token, { algorithms: ['HS256'], requiredClaims: ['sub', 'exp'] })
    const id = payload && typeof payload.sub === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.sub) ? payload.sub : null
    return { botUser: id && await accountExists(id) ? id : null }
  }).onError(({ error, set }) => {
    if (error instanceof BotError) { set.status = error.status; return { error: error.message } }
    if (['VALIDATION', 'NOT_FOUND', 'PARSE'].includes((error as { code?: string }).code ?? '')) return
    set.status = 503; return { error: 'The training room is temporarily unavailable' }
  }).get('/status', ({ botUser }) => {
    if (!botUser) throw new BotError(401, 'Sign in to enter training')
    return { coachConfigured: !!process.env.OPENAI_API_KEY }
  }).post('/move', async ({ botUser, body }) => {
    if (!botUser) throw new BotError(401, 'Sign in to enter training')
    consume(botUser, 'moves')
    const game = readTrainingGame(body.pgn)
    if (game.isGameOver()) throw new BotError(400, 'This training game has finished')
    if (game.turn() === body.playerColor) throw new BotError(400, 'It is your move')
    return { ...await engine(game.fen(), body.level), fen: game.fen() }
  }, { body: t.Object({ ...positionBody, level: t.Union([t.Literal('rookie'), t.Literal('navigator'), t.Literal('captain')]) }) })
    .post('/coach', async ({ botUser, body }) => {
      if (!botUser) throw new BotError(401, 'Sign in to enter training')
      const game = readTrainingGame(body.pgn)
      if (body.kind === 'hint' && game.turn() !== body.playerColor) throw new BotError(400, 'Wait for your turn before asking for a hint')
      const key = `${botUser}:${game.history().join(',')}:${body.playerColor}:${body.kind}:${body.style}:${body.language}:${!!body.automatic}:${(body.recentLessons ?? []).join(',')}`
      for (const [key, value] of cache) if (value.until <= now()) cache.delete(key)
      const cached = cache.get(key)
      if (cached) return cached.value
      consume(botUser, 'coach')
      if (pending.has(botUser) || pending.size >= 2) throw new BotError(429, 'Your coach is still studying a position. Please wait.')
      pending.add(botUser)
      try {
        const context = await teachingContext(game, body.playerColor, body.kind, engine)
        const lesson = chooseLesson(game, body.playerColor, body.language, context) ?? (!body.automatic && context.kind === 'hint' ? recommendationCard(game, context, body.language) : null)
        if (body.automatic && (!lesson || body.recentLessons?.includes(lesson.id))) return { text: '', source: 'engine', reason: 'quiet', silent: true, lessonId: null, fen: game.fen(), suggestedMove: null }
        const explained = await explain({ ...context, ...(lesson ? { selectedLesson: lesson } : {}) }, body.style, body.language)
        const value = { ...explained, ...(explained.source === 'engine' && lesson ? { text: lesson.text } : {}),
          ...(lesson ? { lesson, lessonId: lesson.id } : {}), fen: game.fen(), suggestedMove: context.kind === 'hint' ? context.preferredMove?.uci ?? null : null }
        if (cache.size >= 300) cache.delete(cache.keys().next().value!)
        // Provider outages should be retryable rather than cached for ten minutes.
        if (value.reason !== 'temporarily_unavailable') cache.set(key, { until: now() + 600000, value })
        return value
      } finally { pending.delete(botUser) }
    }, { body: t.Object({ ...positionBody, kind: t.Union([t.Literal('review'), t.Literal('hint')]),
      style: t.Union([t.Literal('patient'), t.Literal('cheeky')]), language: t.Union([t.Literal('en'), t.Literal('ru')]),
      automatic: t.Optional(t.Boolean()), recentLessons: t.Optional(t.Array(t.String({ maxLength: 160 }), { maxItems: 8 })) }) })
    .post('/study/move', async ({ botUser, body }) => {
      if (!botUser) throw new BotError(401, 'Sign in to enter training')
      consume(botUser, 'moves')
      const game = readTrainingGame(body.pgn, true)
      if (game.isGameOver() || game.turn() === body.playerColor) throw new BotError(400, 'There is no bot turn in this position')
      return { ...await engine(game.fen(), body.level), fen: game.fen() }
    }, { body: t.Object({ ...positionBody, level: t.Union([t.Literal('rookie'), t.Literal('navigator'), t.Literal('captain')]) }) })
    .post('/engine', async ({ botUser, body }) => {
      if (!botUser) throw new BotError(401, 'Sign in to enter training')
      consume(botUser, 'moves')
      const game = readTrainingGame(body.pgn, true)
      const context = await teachingContext(game, body.playerColor, body.action === 'review' ? 'review' : 'hint', engine)
      const lesson = chooseLesson(game, body.playerColor, body.language, context)
      const card = body.action === 'best' ? recommendationCard(game, context, body.language) : lesson ?? (body.action === 'threats' || body.action === 'review' ? null : recommendationCard(game, context, body.language))
      const review = context.kind === 'review' ? { beforeFen: game.history({ verbose: true }).findLast(move => move.color === body.playerColor)!.before,
        played: context.move.san, bestMove: context.preferredMove?.uci ?? null, loss: context.centipawnLoss,
        quality: context.centipawnLoss >= 300 ? 'blunder' : context.centipawnLoss >= 150 ? 'mistake' : context.centipawnLoss >= 70 ? 'inaccuracy' : 'good' } : null
      return { fen: game.fen(), source: 'engine', card, review, line: context.shortLine,
        text: card?.text ?? (body.language === 'ru' ? 'В коротком анализе нет ясной новой тактической проблемы.' : 'No clear new tactical problem was found in this short analysis.') }
    }, { body: t.Object({ ...positionBody, action: t.Union([t.Literal('best'), t.Literal('threats'), t.Literal('review'), t.Literal('analyze')]), language: t.Union([t.Literal('en'), t.Literal('ru')]) }) })
    .post('/chat', async ({ botUser, body }) => {
      if (!botUser) throw new BotError(401, 'Sign in to ask your teacher')
      consume(botUser, 'coach')
      if (pending.has(botUser) || pending.size >= 2) throw new BotError(429, 'Your teacher is still considering another position. Please wait.')
      pending.add(botUser)
      try {
        const game = readTrainingGame(body.pgn, true), context = await teachingContext(game, body.playerColor, 'hint', engine)
        return { ...await chat(context, body.message, body.messages, body.style, body.language), fen: game.fen() }
      } finally { pending.delete(botUser) }
    }, { body: t.Object({ ...positionBody, message: t.String({ minLength: 1, maxLength: 800 }),
      messages: t.Array(t.Object({ role: t.Union([t.Literal('user'), t.Literal('assistant')]), content: t.String({ maxLength: 1800 }) }), { maxItems: 10 }),
      style: t.Union([t.Literal('patient'), t.Literal('cheeky')]), language: t.Union([t.Literal('en'), t.Literal('ru')]) }) })
}
export const botRoutes = createBotRoutes()
