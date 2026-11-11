import { warRepository } from '../db/warRepository'
import { CrewError } from '../db/crewRepository'
import { Elysia, t } from 'elysia'
import { authJwt } from '../auth/jwt'

async function getAuthUser(headers: Record<string, string | undefined>, jwtInstance: any) {
  const authHeader = headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const payload = await jwtInstance.verify(token, { algorithms: ['HS256'], requiredClaims: ['sub', 'exp'] })
  return payload && typeof payload.sub === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)
    ? { id: payload.sub, username: payload.username as string } : null
}

export function createWarRoutes(repository = warRepository) {
  return new Elysia({ prefix: '/wars' })
  .use(authJwt)
  .onError(({ error, set }) => {
    if (error instanceof CrewError) { set.status = error.status; return { error: error.message } }
    if (['VALIDATION', 'NOT_FOUND', 'PARSE'].includes((error as { code?: string }).code ?? '')) return
    set.status = 503; return { error: 'War service is temporarily unavailable' }
  })

  .get('/', async ({ headers, jwt, query, set }) => {
    const user = await getAuthUser(headers, jwt)
    if (!user) { set.status = 401; return { error: 'Not authenticated' } }
    const limit = query.limit ?? 20
    const rows = await repository.listForPlayer(user.id, query.status ?? 'all', limit + 1, query.offset ?? 0)
    return { wars: rows.slice(0, limit), hasMore: rows.length > limit }
  }, { query: t.Object({ status: t.Optional(t.Union([t.Literal('all'), t.Literal('pending'), t.Literal('active'), t.Literal('history')])),
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50, multipleOf: 1 })),
    offset: t.Optional(t.Numeric({ minimum: 0, maximum: 10000, multipleOf: 1 })) }) })
  .post('/:id/cancel', async ({ params, headers, jwt, set }) => {
    const user = await getAuthUser(headers, jwt)
    if (!user) { set.status = 401; return { error: 'Not authenticated' } }
    await repository.closePending(user.id, params.id, 'cancel')
    return { message: 'War request cancelled' }
  }, { params: t.Object({ id: t.String({ format: 'uuid' }) }) })
  .post('/:id/decline', async ({ params, headers, jwt, set }) => {
    const user = await getAuthUser(headers, jwt)
    if (!user) { set.status = 401; return { error: 'Not authenticated' } }
    await repository.closePending(user.id, params.id, 'decline')
    return { message: 'War request declined' }
  }, { params: t.Object({ id: t.String({ format: 'uuid' }) }) })

  /* ─── Declare War (captain only) ────────────────────── */
  .post(
    '/',
    async ({ body, headers, jwt, set }) => {
      const user = await getAuthUser(headers, jwt)
      if (!user) { set.status = 401; return { error: 'Not authenticated' } }

      const war = await repository.declare(user.id, body.defenderCrewId, body.matchesPerSide ?? 5)
      return { war }
    },
    {
      body: t.Object({
        defenderCrewId: t.String({ format: 'uuid' }),
        matchesPerSide: t.Optional(t.Number({ minimum: 1, maximum: 15, multipleOf: 1 })),
      }),
    }
  )

  /* ─── Accept War ────────────────────────────────────── */
  .post(
    '/:id/accept',
    async ({ params, headers, jwt, set }) => {
      const user = await getAuthUser(headers, jwt)
      if (!user) { set.status = 401; return { error: 'Not authenticated' } }

      await repository.accept(user.id, params.id)

      return { message: 'War accepted! Captains, pick your fighters.' }
    }, { params: t.Object({ id: t.String({ format: 'uuid' }) }) }
  )

  .post('/:id/fighters', async ({ params, body, headers, jwt, set }) => {
    const user = await getAuthUser(headers, jwt)
    if (!user) { set.status = 401; return { error: 'Not authenticated' } }
    return repository.submitFighters(user.id, params.id, body.fighterIds)
  }, { params: t.Object({ id: t.String({ format: 'uuid' }) }),
    body: t.Object({ fighterIds: t.Array(t.String({ format: 'uuid' }), { minItems: 1, maxItems: 15 }) }) })
  .get('/:id', async ({ params, headers, jwt, set }) => {
    const user = await getAuthUser(headers, jwt)
    if (!user) { set.status = 401; return { error: 'Not authenticated' } }
    return repository.detailForPlayer(user.id, params.id)
  }, { params: t.Object({ id: t.String({ format: 'uuid' }) }) })
}

export const warRoutes = createWarRoutes()
