import { Elysia, t } from 'elysia'
import { authJwt } from '../auth/jwt'
import { crewRepository, CrewError } from '../db/crewRepository'

const crewParams = t.Object({ id: t.String({ format: 'uuid' }) })

export function createCrewRoutes(repository = crewRepository) {
  return new Elysia({ prefix: '/crews' }).use(authJwt)
    .derive(async ({ headers, jwt }) => {
      const token = headers.authorization?.startsWith('Bearer ') ? headers.authorization.slice(7) : undefined
      const payload = await jwt.verify(token, { algorithms: ['HS256'], requiredClaims: ['sub', 'exp'] })
      return { crewUserId: payload && typeof payload.sub === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub) ? payload.sub : null }
    })
    .onError(({ error, set }) => {
      if (error instanceof CrewError) { set.status = error.status; return { error: error.message } }
      const pg = error as { code?: string; cause?: { code?: string } }
      if (pg.code === '23505' || pg.cause?.code === '23505') {
        set.status = 409; return { error: 'Crew name, tag or membership is already taken' }
      }
      if (['VALIDATION', 'NOT_FOUND', 'PARSE'].includes(pg.code ?? '')) return
      set.status = 503; return { error: 'Crew service is temporarily unavailable' }
    })
    .get('/mine', ({ crewUserId }) => {
      if (!crewUserId) throw new CrewError(401, 'Not authenticated')
      return repository.mine(crewUserId)
    })
    .get('/', async ({ query }) => {
      const limit = query.limit ?? 20
      const rows = await repository.list(query.search?.trim() ?? '', limit + 1, query.offset ?? 0)
      return { crews: rows.slice(0, limit), hasMore: rows.length > limit }
    }, { query: t.Object({ search: t.Optional(t.String({ maxLength: 64 })),
      limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50, multipleOf: 1 })),
      offset: t.Optional(t.Numeric({ minimum: 0, maximum: 10000, multipleOf: 1 })) }) })
    .get('/:id', ({ params }) => repository.detail(params.id), { params: crewParams })
    .post('/', async ({ crewUserId, body }) => {
      if (!crewUserId) throw new CrewError(401, 'Not authenticated')
      const { crew } = await repository.create(crewUserId, body)
      return { crew }
    }, { body: t.Object({ name: t.String({ minLength: 3, maxLength: 64 }), tag: t.String({ minLength: 2, maxLength: 10 }),
      description: t.Optional(t.String({ maxLength: 500 })) }) })
    .post('/:id/join', async ({ crewUserId, params }) => {
      if (!crewUserId) throw new CrewError(401, 'Not authenticated')
      await repository.join(crewUserId, params.id)
      return { message: 'Joined crew successfully' }
    }, { params: crewParams })
    .post('/:id/leave', async ({ crewUserId, params }) => {
      if (!crewUserId) throw new CrewError(401, 'Not authenticated')
      await repository.leave(crewUserId, params.id)
      return { message: 'Left crew successfully' }
    }, { params: crewParams })
    .put('/:id/members/:userId/role', async ({ crewUserId, params, body }) => {
      if (!crewUserId) throw new CrewError(401, 'Not authenticated')
      await repository.setRole(crewUserId, params.id, params.userId, body.role)
      return { message: 'Crew role updated' }
    }, { params: t.Object({ id: t.String({ format: 'uuid' }), userId: t.String({ format: 'uuid' }) }),
      body: t.Object({ role: t.Union([t.Literal('member'), t.Literal('officer')]) }) })
    .post('/:id/disband', async ({ crewUserId, params }) => {
      if (!crewUserId) throw new CrewError(401, 'Not authenticated')
      await repository.disband(crewUserId, params.id)
      return { message: 'Crew disbanded. Its history has been preserved.' }
    }, { params: crewParams })
    .post('/:id/transfer', async ({ crewUserId, params, body }) => {
      if (!crewUserId) throw new CrewError(401, 'Not authenticated')
      await repository.transferCaptain(crewUserId, params.id, body.userId)
      return { message: 'Captaincy transferred. You are now an officer.' }
    }, { params: crewParams, body: t.Object({ userId: t.String({ format: 'uuid' }) }) })
    .delete('/:id/members/:userId', async ({ crewUserId, params }) => {
      if (!crewUserId) throw new CrewError(401, 'Not authenticated')
      await repository.kick(crewUserId, params.id, params.userId)
      return { message: 'Member kicked successfully' }
    }, { params: t.Object({ id: t.String({ format: 'uuid' }), userId: t.String({ format: 'uuid' }) }) })
}

export const crewRoutes = createCrewRoutes()
