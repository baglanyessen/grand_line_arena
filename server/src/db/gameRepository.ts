import { settleLeadership } from './leadershipLifecycle'
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { db } from './index'
import { games, users, gameRewards, warMatches, crewWars, warRewards, warSettlements, leadershipChallenges, leadershipMatches, crews } from './schema'
import { settleWar, reconcileWar } from './warSettlement'
import { calculateBounty, pgnPlies } from './bounty'

export interface CompletedGame {
  id: string
  whiteId: string
  blackId: string
  pgn: string
  result: 'white' | 'black' | 'draw'
  startedAt: string
  endedAt: string
  warMatchId?: string
  leadershipMatchId?: string
}

export function validateCompletedGame(value: unknown): CompletedGame {
  if (!value || typeof value !== 'object') throw new Error('Invalid completed game')
  const row = value as Record<string, unknown>
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  for (const key of ['id', 'whiteId', 'blackId'])
    if (typeof row[key] !== 'string' || !uuid.test(row[key] as string)) throw new Error('Invalid game identity')
  if (row.whiteId === row.blackId || !['white', 'black', 'draw'].includes(row.result as string) ||
      typeof row.pgn !== 'string' || row.pgn.length > 1_000_000 ||
      typeof row.startedAt !== 'string' || typeof row.endedAt !== 'string') throw new Error('Invalid game result')
  const start = new Date(row.startedAt), end = new Date(row.endedAt)
  if (row.leadershipMatchId !== undefined && (typeof row.leadershipMatchId !== 'string' || row.leadershipMatchId !== row.id || !uuid.test(row.leadershipMatchId) || row.warMatchId !== undefined)) throw new Error('Invalid leadership match identity')
  if (row.warMatchId !== undefined && (typeof row.warMatchId !== 'string' || !uuid.test(row.warMatchId) || row.warMatchId !== row.id)) throw new Error('Invalid war match identity')
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) throw new Error('Invalid game dates')
  return { id: row.id as string, whiteId: row.whiteId as string, blackId: row.blackId as string,
    pgn: row.pgn, result: row.result as CompletedGame['result'], startedAt: start.toISOString(), endedAt: end.toISOString(),
    ...(row.warMatchId ? { warMatchId: row.warMatchId as string } : {}), ...(row.leadershipMatchId ? { leadershipMatchId: row.leadershipMatchId as string } : {}) }
}

export function createGameRepository(database: PostgresJsDatabase<typeof import('./schema')> = db) {
  const white = alias(users, 'white_player'), black = alias(users, 'black_player')
  const fields = { id: games.id, whiteId: games.whiteId, blackId: games.blackId, result: games.result,
    startedAt: games.startedAt, endedAt: games.endedAt, whiteName: white.username, blackName: black.username,
    bountyReward: { whiteDelta: gameRewards.whiteDelta, blackDelta: gameRewards.blackDelta,
      whiteAfter: gameRewards.whiteAfter, blackAfter: gameRewards.blackAfter,
      status: gameRewards.status, policyVersion: gameRewards.policyVersion } }
  return {
    async save(input: CompletedGame) {
      const record = validateCompletedGame(input)
      await database.transaction(async tx => {
        const [inserted] = await tx.insert(games).values({ ...record,
          startedAt: new Date(record.startedAt), endedAt: new Date(record.endedAt) })
          .onConflictDoNothing({ target: games.id }).returning({ id: games.id })
        if (inserted) {
          let war: typeof crewWars.$inferSelect | undefined
          let leadership: typeof leadershipChallenges.$inferSelect | undefined
          let accountIds = [record.whiteId, record.blackId]
          if (record.warMatchId) {
            const [assignment] = await tx.select().from(warMatches).where(eq(warMatches.id, record.warMatchId))
            if (!assignment) throw new Error('War match result conflicts with its assignment')
            const boards = await tx.select().from(warMatches).where(eq(warMatches.warId, assignment.warId))
            accountIds = [...new Set(boards.flatMap(board => [board.whiteId, board.blackId]))]
          }
          // Global user ordering also covers simultaneous final boards and ordinary bounty updates.
          const accounts = await tx.select({ id: users.id, bounty: users.bounty }).from(users)
            .where(inArray(users.id, accountIds)).orderBy(asc(users.id)).for('no key update')
          if (record.warMatchId) {
            const [assignment] = await tx.select().from(warMatches).where(eq(warMatches.id, record.warMatchId))
            const [lockedWar] = await tx.select().from(crewWars).where(eq(crewWars.id, assignment!.warId)).for('no key update')
            war = lockedWar
            const [match] = await tx.select().from(warMatches).where(eq(warMatches.id, record.warMatchId)).for('no key update')
            if (!match || match.whiteId !== record.whiteId || match.blackId !== record.blackId || match.result !== 'pending' || match.gameId)
              throw new Error('War match result conflicts with its assignment')
            if (!war || war.status !== 'active') throw new Error('War is no longer active')
            await tx.update(warMatches).set({ gameId: record.id, result: record.result, endedAt: new Date(record.endedAt), endReason: 'played' }).where(eq(warMatches.id, match.id))
          }
          if (record.leadershipMatchId) {
            const [assignment] = await tx.select().from(leadershipMatches).where(eq(leadershipMatches.id, record.leadershipMatchId))
            if (!assignment) throw new Error('Leadership match assignment missing')
            const [initial] = await tx.select().from(leadershipChallenges).where(eq(leadershipChallenges.id, assignment.challengeId))
            if (!initial) throw new Error('Leadership challenge missing')
            await tx.select({ id: crews.id }).from(crews).where(eq(crews.id, initial.crewId)).for('no key update')
            const [locked] = await tx.select().from(leadershipChallenges).where(eq(leadershipChallenges.id, initial.id)).for('no key update')
            leadership = locked
            const [match] = await tx.select().from(leadershipMatches).where(eq(leadershipMatches.id, assignment.id)).for('no key update')
            if (locked?.status !== 'active' || !match || match.result !== 'pending' || match.gameId || match.whiteId !== record.whiteId || match.blackId !== record.blackId) throw new Error('Leadership result conflicts with assignment')
            await tx.update(leadershipMatches).set({ gameId: record.id, result: record.result, endedAt: new Date(record.endedAt), endReason: 'played' }).where(eq(leadershipMatches.id, match.id))
          }
          const white = accounts.find(account => account.id === record.whiteId)
          const black = accounts.find(account => account.id === record.blackId)
          if (!white || !black) throw new Error('Missing game participants')
          const start = new Date(record.endedAt); start.setUTCHours(0, 0, 0, 0)
          const end = new Date(start.getTime() + 86400000)
          const [count] = await tx.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(gameRewards)
            .innerJoin(games, eq(gameRewards.gameId, games.id)).where(and(eq(gameRewards.status, 'awarded'),
              inArray(games.whiteId, [white.id, black.id]), inArray(games.blackId, [white.id, black.id]),
              gte(games.endedAt, start), lt(games.endedAt, end)))
          const reward = calculateBounty(record.result, white.bounty, black.bounty, pgnPlies(record.pgn), count?.value ?? 0)
          await tx.insert(gameRewards).values({ gameId: record.id, ...reward })
          for (const [id, delta, after] of [[white.id, reward.whiteDelta, reward.whiteAfter], [black.id, reward.blackDelta, reward.blackAfter]] as const)
            if (delta !== 0) await tx.update(users).set({ bounty: after, bountyVersion: sql`${users.bountyVersion} + 1` }).where(eq(users.id, id))
          if (war) await settleWar(tx, war)
          if (leadership) await settleLeadership(tx, leadership)
          return
        }
        const [existing] = await tx.select().from(games).where(eq(games.id, record.id)).limit(1)
        if (!existing || existing.whiteId !== record.whiteId || existing.blackId !== record.blackId ||
            existing.result !== record.result || existing.pgn !== record.pgn ||
            existing.startedAt.toISOString() !== record.startedAt || existing.endedAt?.toISOString() !== record.endedAt)
          throw new Error('Conflicting result for an existing game ID')
        if (record.warMatchId) {
          const [match] = await tx.select().from(warMatches).where(eq(warMatches.id, record.warMatchId))
          if (!match || match.gameId !== record.id || match.result !== record.result || match.whiteId !== record.whiteId || match.blackId !== record.blackId)
            throw new Error('Saved game is not linked to this war match')
          await reconcileWar(tx, match.warId)
        }
        if (record.leadershipMatchId) {
          const [match] = await tx.select().from(leadershipMatches).where(eq(leadershipMatches.id, record.leadershipMatchId))
          if (!match || match.gameId !== record.id || match.result !== record.result || match.whiteId !== record.whiteId || match.blackId !== record.blackId) throw new Error('Saved game is not linked to its leadership match')
        }
      })
    },
    async settlement(gameId: string) {
      const [reward] = await database.select().from(gameRewards).where(eq(gameRewards.gameId, gameId)).limit(1)
      return reward ?? null
    },
    async warSettlementForGame(gameId: string) {
      const [match] = await database.select().from(warMatches).where(eq(warMatches.gameId, gameId)).limit(1)
      if (!match) return null
      const [war] = await database.select().from(crewWars).where(eq(crewWars.id, match.warId))
      const [settlement] = await database.select().from(warSettlements).where(eq(warSettlements.warId, match.warId))
      const rewards = settlement ? await database.select().from(warRewards).where(eq(warRewards.warId, match.warId)) : []
      const boards = await database.select({ id: warMatches.id }).from(warMatches).where(eq(warMatches.warId, match.warId))
      return { war, settlement: settlement ?? null, rewards, matchIds: boards.map(board => board.id) }
    },
    async playerBounties(ids: string[]) {
      return database.select({ id: users.id, bounty: users.bounty, bountyVersion: users.bountyVersion })
        .from(users).where(inArray(users.id, ids))
    },
    async listForPlayer(userId: string, limit = 20, offset = 0) {
      return database.select(fields).from(games)
        .innerJoin(white, eq(games.whiteId, white.id)).innerJoin(black, eq(games.blackId, black.id))
        .leftJoin(gameRewards, eq(gameRewards.gameId, games.id))
        .where(and(or(eq(games.whiteId, userId), eq(games.blackId, userId)), ne(games.result, 'ongoing'), isNotNull(games.endedAt)))
        .orderBy(desc(games.endedAt), desc(games.id)).limit(limit).offset(offset)
    },
    async findForPlayer(gameId: string, userId: string) {
      const [game] = await database.select({ ...fields, pgn: games.pgn }).from(games)
        .innerJoin(white, eq(games.whiteId, white.id)).innerJoin(black, eq(games.blackId, black.id))
        .leftJoin(gameRewards, eq(gameRewards.gameId, games.id))
        .where(and(eq(games.id, gameId), or(eq(games.whiteId, userId), eq(games.blackId, userId)),
          ne(games.result, 'ongoing'), isNotNull(games.endedAt))).limit(1)
      return game ?? null
    },
  }
}

export const gameRepository = createGameRepository()
