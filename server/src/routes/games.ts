import { Elysia, t } from 'elysia'
import { authJwt } from '../auth/jwt'
import { gameRepository } from '../db/gameRepository'

export function createGameRoutes(repository = gameRepository) {
  return new Elysia({ prefix: '/games' }).use(authJwt)
    .derive(async ({ headers, jwt }) => {
      const token = headers.authorization?.startsWith('Bearer ') ? headers.authorization.slice(7) : undefined
      const payload = await jwt.verify(token, { algorithms: ['HS256'], requiredClaims: ['sub', 'exp'] })
      if (!payload || typeof payload.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub))
        return { historyUserId: null }
      return { historyUserId: payload.sub }
    })
    .get('/', async ({ historyUserId, query, set }) => {
      if (!historyUserId) { set.status = 401; return { error: 'Not authenticated' } }
      try { return { games: await repository.listForPlayer(historyUserId, query.limit ?? 20, query.offset ?? 0) } }
      catch { set.status = 503; return { error: 'Game history is temporarily unavailable' } }
    }, { query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50, multipleOf: 1 })),
      offset: t.Optional(t.Numeric({ minimum: 0, maximum: 10000, multipleOf: 1 })) }) })
    .get('/:id', async ({ historyUserId, params, set }) => {
      if (!historyUserId) { set.status = 401; return { error: 'Not authenticated' } }
      try {
        const game = await repository.findForPlayer(params.id, historyUserId)
        if (!game) { set.status = 404; return { error: 'Game not found' } }
        return { game }
      } catch { set.status = 503; return { error: 'Game history is temporarily unavailable' } }
    }, { params: t.Object({ id: t.String({ format: 'uuid' }) }) })
}

export const gameRoutes = createGameRoutes()
