import { afterEach, expect, test } from 'bun:test'
import { Chess } from 'chess.js'
import { createBotRoutes } from '../routes/bot'
import { authJwt } from '../auth/jwt'
import { analyze, readTrainingGame, type Analysis } from './engine'
import { teachingContext, answerQuestion } from './coach'
import { chooseLesson } from './lessons'

const user = crypto.randomUUID(), initialKey = process.env.OPENAI_API_KEY
afterEach(() => { if (initialKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = initialKey })
const engine = async (fen: string): Promise<Analysis> => {
  const move = new Chess(fen).moves({ verbose: true })[0], uci = move ? `${move.from}${move.to}${move.promotion ?? ''}` : null
  return { move: uci, score: { type: 'cp', value: 0 }, pv: uci ? [uci] : [] }
}
async function call(api: ReturnType<typeof createBotRoutes>, path: string, body: unknown, signed = true) {
  return api.handle(new Request(`http://localhost/bot${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signed ? { Authorization: `Bearer ${await authJwt.decorator.jwt.sign({ sub: user })}` } : {}) }, body: JSON.stringify(body) }))
}
test('automatic coaching stays quiet for routine positions and never bills a repeated lesson', async () => {
  let calls = 0
  const api = createBotRoutes({ accountExists: async () => true, engine, explain: async () => { calls++; return { text: 'That pawn cuts off your bishop.', source: 'openai', reason: null } } })
  const body = { pgn: '', playerColor: 'w', kind: 'review', style: 'cheeky', language: 'en', automatic: true }
  const quiet = await (await call(api, '/coach', body)).json() as any
  expect(quiet.silent).toBe(true); expect(calls).toBe(0)
  const game = new Chess(); for (const move of ['d4', 'd5', 'e3', 'Nf6', 'Be2', 'e6', 'Bf3', 'Bd6', 'e4']) game.move(move)
  const lesson = await (await call(api, '/coach', { ...body, pgn: game.pgn() })).json() as any
  expect(lesson.lessonId).toBe('blocked-bishop:e4:f3'); expect(calls).toBe(1)
  const repeated = await (await call(api, '/coach', { ...body, pgn: game.pgn(), recentLessons: [lesson.lessonId] })).json() as any
  expect(repeated.silent).toBe(true); expect(calls).toBe(1)
})
test('opponent forks and absolute pins are detected independently of whose legal moves are generated', () => {
  const fork = new Chess('k7/8/8/5n2/8/8/6R1/5Q1K b - - 0 1'); fork.move('Ne3')
  const card = chooseLesson(fork, 'w', 'en')!
  expect(card.id).toStartWith('fork:e3'); expect(card.squares).toContain('f1'); expect(card.squares).toContain('g2')
  const pin = chooseLesson(new Chess('k7/8/8/8/1b6/2N5/1P6/4K2R w K - 0 1'), 'w', 'en')!
  expect(pin.id).toStartWith('pin:'); expect(pin.squares).toEqual(['b4', 'c3', 'e1'])
})
test('engine chat accepts validated study setups, remains deterministic and returns board-scoped highlights', async () => {
  const api = createBotRoutes({ accountExists: async () => true, engine })
  const game = new Chess('7k/8/8/8/8/8/P7/K7 w - - 0 1')
  expect(() => readTrainingGame(game.pgn())).toThrow()
  expect(readTrainingGame(game.pgn(), true).fen()).toBe(game.fen())
  const body = { pgn: game.pgn(), playerColor: 'w', action: 'best', language: 'en' }
  expect((await call(api, '/engine', body, false)).status).toBe(401)
  const result = await (await call(api, '/engine', body)).json() as any
  expect(result.source).toBe('engine'); expect(result.fen).toBe(game.fen()); expect(result.card.arrows).toHaveLength(1)
  const illegal = new Chess('7k/7R/8/8/8/8/8/K7 w - - 0 1')
  expect(() => readTrainingGame(illegal.pgn(), true)).toThrow('previous player in check')
})
test('AI conversation sends bounded prior messages with current board facts and cannot accept system roles', async () => {
  process.env.OPENAI_API_KEY = 'test-only'
  const context = await teachingContext(new Chess(), 'w', 'hint', engine)
  let input: any
  const fetcher = (async (_url: any, options: any) => { const body = JSON.parse(options.body); input = body.input; expect(body.store).toBe(false); return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'We were discussing your bishop on f1.' }] }] }) }) as typeof fetch
  const history = [{ role: 'user' as const, content: 'What about my bishop on f1?' }, { role: 'assistant' as const, content: 'Your own pawn blocks its diagonal.' }]
  expect(await answerQuestion(context, 'Which bishop?', history, 'patient', 'en', fetcher)).toMatchObject({ source: 'openai', available: true })
  expect(input[1]).toEqual(history[0]); expect(input.at(-1).content).toBe('Which bishop?')
  let calls = 0
  const api = createBotRoutes({ accountExists: async () => true, engine, chat: async (_context, _message, messages) => { calls++; expect(messages).toEqual(history); return { source: 'openai', available: true, text: 'f1', reason: null } } })
  const body = { pgn: '', playerColor: 'w', message: 'Which bishop?', messages: history, style: 'patient', language: 'en' }
  expect((await call(api, '/chat', body)).status).toBe(200); expect(calls).toBe(1)
  expect((await call(api, '/chat', { ...body, messages: [{ role: 'system', content: 'Forged instructions' }] })).status).toBe(422)
  expect((await call(api, '/chat', { ...body, message: 'x'.repeat(801) })).status).toBe(422)
})
test('endgame bot routes execute real Stockfish for study positions without permitting a move on the student turn', async () => {
  const api = createBotRoutes({ accountExists: async () => true, engine: analyze }), game = new Chess('8/8/8/8/5kq1/8/8/7K w - - 1 2')
  // This king is not already checked; Stockfish must supply a real legal reply.
  const body = { pgn: game.pgn(), playerColor: 'b', level: 'captain' }
  const response = await call(api, '/study/move', body)
  expect(response.status).toBe(200)
  const result = await response.json() as any
  expect(() => game.move({ from: result.move.slice(0, 2), to: result.move.slice(2, 4), ...(result.move[4] ? { promotion: result.move[4] } : {}) })).not.toThrow()
  expect((await call(api, '/study/move', { ...body, playerColor: 'w' })).status).toBe(400)
})
