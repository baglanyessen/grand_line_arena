import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from './index'
import { crews, crewWars, users, warFighters, warMatches, warSettlements, activeGames, activeEngineOwner } from './schema'
import { settleWar } from './warSettlement'

export const WAR_STAGE_MS = 24 * 60 * 60 * 1000

export function createWarDeadlineProcessor(database = db) {
  async function expire(warId: string, at = new Date(), protectedMatch: (id: string) => boolean = () => false, ownerToken?: string) {
    await database.transaction(async tx => {
      if (ownerToken) {
        const [owner] = await tx.select({ token: activeEngineOwner.token }).from(activeEngineOwner).where(eq(activeEngineOwner.id, true)).for('share')
        if (owner?.token !== ownerToken) return
      }
      const initial = await tx.select().from(crewWars).where(eq(crewWars.id, warId)).limit(1)
      if (!initial[0] || !['pending', 'active'].includes(initial[0].status)) return
      const boards = await tx.select().from(warMatches).where(eq(warMatches.warId, warId))
      if (!boards.length) {
        await tx.select({ id: crews.id }).from(crews).where(inArray(crews.id, [initial[0].challengerCrewId, initial[0].defenderCrewId])).orderBy(asc(crews.id)).for('no key update')
      } else {
        const ids = [...new Set(boards.flatMap(board => [board.whiteId, board.blackId]))]
        await tx.select({ id: users.id }).from(users).where(inArray(users.id, ids)).orderBy(asc(users.id)).for('no key update')
      }
      const [war] = await tx.select().from(crewWars).where(eq(crewWars.id, warId)).for('no key update')
      if (!war) return
      if (war.status === 'pending' && war.requestDeadline <= at) {
        await tx.update(crewWars).set({ status: 'cancelled', endedAt: war.requestDeadline, endReason: 'request_expired' }).where(eq(crewWars.id, warId)); return
      }
      if (war.status !== 'active') return
      const current = await tx.select().from(warMatches).where(eq(warMatches.warId, warId))
      if (!current.length && war.rosterDeadline && war.rosterDeadline <= at) {
        const fighters = await tx.select().from(warFighters).where(eq(warFighters.warId, warId))
        const a = fighters.filter(fighter => fighter.crewId === war.challengerCrewId).length === war.matchesPerSide
        const b = fighters.filter(fighter => fighter.crewId === war.defenderCrewId).length === war.matchesPerSide
        const winner = a !== b ? a ? war.challengerCrewId : war.defenderCrewId : null
        await tx.update(crewWars).set({ status: winner ? 'completed' : 'cancelled', endedAt: war.rosterDeadline, endReason: 'roster_timeout', winnerCrewId: winner,
          challengerScoreHalf: winner === war.challengerCrewId ? war.matchesPerSide * 2 : 0,
          defenderScoreHalf: winner === war.defenderCrewId ? war.matchesPerSide * 2 : 0 }).where(eq(crewWars.id, warId))
        if (winner) await tx.insert(warSettlements).values({ warId, status: 'forfeit', policyVersion: 1, settledAt: at })
        return
      }
      if (!boards.length) return // Pairings appeared while acquiring crew locks; process them next time with user locks.
      let changed = false
      for (const board of current) {
        if (board.result !== 'pending' || board.joinDeadline > at || protectedMatch(board.id)) continue
        const [saved] = await tx.select({ id: activeGames.id }).from(activeGames).where(eq(activeGames.id, board.id)).limit(1)
        if (saved) continue
        const white = !!board.whiteReadyAt, black = !!board.blackReadyAt
        const endReason = white && black ? 'server_interrupted' : white || black ? 'opponent_absent' : 'both_absent'
        await tx.update(warMatches).set({ result: white !== black ? white ? 'white' : 'black' : 'draw', endReason, endedAt: board.joinDeadline }).where(eq(warMatches.id, board.id))
        changed = true
      }
      if (changed) await settleWar(tx, war)
    })
  }
  return {
    expire,
    async sweep(at = new Date(), protectedMatch: (id: string) => boolean = () => false, ownerToken?: string) {
      const due = await database.select({ id: crewWars.id }).from(crewWars).where(or(
        and(eq(crewWars.status, 'pending'), sql`${crewWars.requestDeadline} <= ${at.toISOString()}`),
        and(eq(crewWars.status, 'active'), sql`(
          (${crewWars.rosterDeadline} <= ${at.toISOString()} AND NOT EXISTS (SELECT 1 FROM war_matches m WHERE m.war_id = "crew_wars"."id"))
          OR EXISTS (SELECT 1 FROM war_matches m WHERE m.war_id = "crew_wars"."id" AND m.result = 'pending' AND m.join_deadline <= ${at.toISOString()}))`)))
      for (const war of due) {
        try { await expire(war.id, at, protectedMatch, ownerToken) }
        catch { console.error(`[WAR] Deadline processing failed for ${war.id}; retrying on the next tick`) }
      }
    },
  }
}
