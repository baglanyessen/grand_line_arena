import { Elysia, t } from 'elysia'
import { asc, desc, sql } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'

export function createPlayerRepository(database = db) {
  return {
    async leaderboard(limit: number, offset: number) {
      return database.select({ id: users.id, username: users.username, bounty: users.bounty,
        rank: sql<number>`row_number() over (order by ${users.bounty} desc, ${users.username} asc, ${users.id} asc)`.mapWith(Number) })
        .from(users).orderBy(desc(users.bounty), asc(users.username), asc(users.id)).limit(limit).offset(offset)
    },
  }
}

export function createPlayerRoutes(repository = createPlayerRepository()) {
  return new Elysia({ prefix: '/players' }).get('/leaderboard', async ({ query, set }) => {
    const limit = query.limit ?? 20
    try {
      const rows = await repository.leaderboard(limit + 1, query.offset ?? 0)
      return { players: rows.slice(0, limit), hasMore: rows.length > limit }
    } catch { set.status = 503; return { error: 'Bounty standings are temporarily unavailable' } }
  }, { query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50, multipleOf: 1 })),
    offset: t.Optional(t.Numeric({ minimum: 0, maximum: 10000, multipleOf: 1 })) }) })
}

export const playerRoutes = createPlayerRoutes()
