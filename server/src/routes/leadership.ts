import { Elysia, t } from 'elysia'
import { authJwt } from '../auth/jwt'
import { leadershipRepository } from '../db/leadershipRepository'
import { CrewError } from '../db/crewError'

export function createLeadershipRoutes(repository = leadershipRepository) {
  return new Elysia({ prefix: '/leadership' }).use(authJwt).derive(async ({ headers, jwt }) => {
    const token = headers.authorization?.startsWith('Bearer ') ? headers.authorization.slice(7) : undefined
    const payload = await jwt.verify(token, { algorithms: ['HS256'], requiredClaims: ['sub', 'exp'] })
    return { leaderUserId: payload && typeof payload.sub === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub) ? payload.sub : null }
  }).onError(({ error, set }) => {
    if (error instanceof CrewError) { set.status = error.status; return { error: error.message } }
    if (['VALIDATION', 'NOT_FOUND', 'PARSE'].includes((error as { code?: string }).code ?? '')) return
    set.status = 503; return { error: 'Leadership service is temporarily unavailable' }
  }).get('/crew/:id', async ({ leaderUserId, params, query }) => {
    if (!leaderUserId) throw new CrewError(401, 'Not authenticated')
    const limit = query.limit ?? 20, rows = await repository.list(leaderUserId, params.id, limit + 1, query.offset ?? 0)
    return { challenges: rows.slice(0, limit), hasMore: rows.length > limit }
  }, { params: t.Object({ id: t.String({ format: 'uuid' }) }), query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50, multipleOf: 1 })), offset: t.Optional(t.Numeric({ minimum: 0, maximum: 10000, multipleOf: 1 })) }) })
    .post('/crew/:id', ({ leaderUserId, params }) => {
      if (!leaderUserId) throw new CrewError(401, 'Not authenticated')
      return repository.create(leaderUserId, params.id).then(challenge => ({ challenge }))
    }, { params: t.Object({ id: t.String({ format: 'uuid' }) }) })
    .post('/:id/:action', async ({ leaderUserId, params }) => {
      if (!leaderUserId) throw new CrewError(401, 'Not authenticated')
      await repository.respond(leaderUserId, params.id, params.action)
      return { message: 'Challenge updated' }
    }, { params: t.Object({ id: t.String({ format: 'uuid' }), action: t.Union([t.Literal('accept'), t.Literal('decline'), t.Literal('cancel')]) }) })
}
export const leadershipRoutes = createLeadershipRoutes()
