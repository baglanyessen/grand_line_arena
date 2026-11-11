import { and, asc, desc, eq, gte, inArray, or, gt } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from './index'
import { crews, crewMembers, crewWars, leadershipChallenges, leadershipMatches, users } from './schema'
import { CrewError } from './crewError'
import { guardLeadership, LEADERSHIP_WINDOW_MS, nextLeadershipRound } from './leadershipLifecycle'

export function createLeadershipRepository(database = db) {
  return {
    async list(actorId: string, crewId: string, limit = 20, offset = 0) {
      return database.transaction(async tx => {
        const [member] = await tx.select().from(crewMembers).where(and(eq(crewMembers.userId, actorId), eq(crewMembers.crewId, crewId)))
        if (!member) throw new CrewError(403, 'Join this crew to view leadership challenges')
        const challenger = alias(users, 'challenger'), captain = alias(users, 'captain')
        const rows = await tx.select({ challenge: leadershipChallenges, challengerName: challenger.username, captainName: captain.username }).from(leadershipChallenges)
          .innerJoin(challenger, eq(challenger.id, leadershipChallenges.challengerId)).innerJoin(captain, eq(captain.id, leadershipChallenges.captainId))
          .where(eq(leadershipChallenges.crewId, crewId)).orderBy(desc(leadershipChallenges.createdAt), desc(leadershipChallenges.id)).limit(limit).offset(offset)
        const ids = rows.map(row => row.challenge.id)
        const matches = ids.length ? await tx.select().from(leadershipMatches).where(inArray(leadershipMatches.challengeId, ids)).orderBy(asc(leadershipMatches.round)) : []
        return rows.map(row => ({ ...row.challenge, challengerName: row.challengerName, captainName: row.captainName,
          matches: matches.filter(match => match.challengeId === row.challenge.id) }))
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
    },
    async create(actorId: string, crewId: string) {
      return database.transaction(async tx => {
        const [crew] = await tx.select().from(crews).where(eq(crews.id, crewId)).for('no key update')
        if (!crew || crew.disbandedAt) throw new CrewError(404, 'Crew not found')
        const [member] = await tx.select().from(crewMembers).where(and(eq(crewMembers.userId, actorId), eq(crewMembers.crewId, crewId)))
        if (!member || actorId === crew.captainId) throw new CrewError(403, 'Only a current non-captain crew member can challenge the captain')
        await guardLeadership(tx, crewId)
        const [war] = await tx.select({ id: crewWars.id }).from(crewWars).where(and(or(eq(crewWars.challengerCrewId, crewId), eq(crewWars.defenderCrewId, crewId)), inArray(crewWars.status, ['pending', 'active']))).limit(1)
        if (war) throw new CrewError(409, 'Resolve crew wars before starting a leadership challenge')
        const [recent] = await tx.select({ id: leadershipChallenges.id }).from(leadershipChallenges).where(and(eq(leadershipChallenges.challengerId, actorId), gte(leadershipChallenges.createdAt, new Date(Date.now() - LEADERSHIP_WINDOW_MS)))).limit(1)
        if (recent) throw new CrewError(409, 'You may issue one leadership challenge every 24 hours')
        const [challenge] = await tx.insert(leadershipChallenges).values({ crewId, challengerId: actorId, captainId: crew.captainId,
          requestDeadline: new Date(Date.now() + LEADERSHIP_WINDOW_MS), createdAt: new Date() }).returning()
        return challenge!
      })
    },
    async respond(actorId: string, id: string, action: 'accept' | 'decline' | 'cancel') {
      await database.transaction(async tx => {
        const [initial] = await tx.select().from(leadershipChallenges).where(eq(leadershipChallenges.id, id))
        if (!initial) throw new CrewError(404, 'Challenge not found')
        const [crew] = await tx.select().from(crews).where(eq(crews.id, initial.crewId)).for('no key update')
        const [challenge] = await tx.select().from(leadershipChallenges).where(eq(leadershipChallenges.id, id)).for('no key update')
        if (!challenge || challenge.status !== 'pending' || challenge.requestDeadline.getTime() <= Date.now()) throw new CrewError(409, 'This challenge is no longer awaiting a response')
        const roster = await tx.select().from(crewMembers).where(eq(crewMembers.crewId, initial.crewId))
        if (!crew || crew.disbandedAt || crew.captainId !== challenge.captainId || !roster.some(member => member.userId === challenge.challengerId)) throw new CrewError(409, 'Challenge participants have changed')
        if (action === 'cancel' ? actorId !== challenge.challengerId : actorId !== challenge.captainId) throw new CrewError(403, 'You cannot perform this challenge action')
        if (action === 'accept') {
          await tx.update(leadershipChallenges).set({ status: 'active' }).where(eq(leadershipChallenges.id, id))
          await nextLeadershipRound(tx, challenge, 1)
        } else await tx.update(leadershipChallenges).set({ status: action === 'decline' ? 'declined' : 'cancelled', endedAt: new Date(), endReason: action }).where(eq(leadershipChallenges.id, id))
      })
    },
    async checkInForPlayer(actorId: string, matchId: string) {
      return database.transaction(async tx => {
        const [initial] = await tx.select().from(leadershipMatches).where(eq(leadershipMatches.id, matchId))
        if (!initial || ![initial.whiteId, initial.blackId].includes(actorId)) throw new CrewError(403, 'You are not assigned to this leadership match')
        const [challenge] = await tx.select().from(leadershipChallenges).where(eq(leadershipChallenges.id, initial.challengeId)).for('no key update')
        const [match] = await tx.select().from(leadershipMatches).where(eq(leadershipMatches.id, matchId)).for('no key update')
        if (challenge?.status !== 'active' || !match || match.result !== 'pending' || match.gameId || match.joinDeadline.getTime() <= Date.now()) throw new CrewError(409, 'This leadership match is closed')
        const previous = actorId === match.whiteId ? match.whiteReadyAt : match.blackReadyAt
        const readyAt = new Date(Math.max(Date.now(), (previous?.getTime() ?? 0) + 1))
        await tx.update(leadershipMatches).set(actorId === match.whiteId ? { whiteReadyAt: readyAt } : { blackReadyAt: readyAt }).where(eq(leadershipMatches.id, matchId))
        return { id: match.id, whiteId: match.whiteId, blackId: match.blackId, readyAt: readyAt.toISOString(), joinDeadline: match.joinDeadline.toISOString() }
      })
    },
    async inspect(actorId: string, matchId: string) {
      const [row] = await database.select({ match: leadershipMatches, status: leadershipChallenges.status }).from(leadershipMatches)
        .innerJoin(leadershipChallenges, eq(leadershipChallenges.id, leadershipMatches.challengeId)).where(eq(leadershipMatches.id, matchId))
      if (!row || ![row.match.whiteId, row.match.blackId].includes(actorId)) throw new CrewError(403, 'Not assigned')
      if (row.status !== 'active' || row.match.result !== 'pending' || row.match.joinDeadline.getTime() <= Date.now()) throw new CrewError(409, 'Leadership match is closed')
    },
    async clearReady(actorId: string, matchId: string, readyAt: string) {
      await database.transaction(async tx => {
        const [initial] = await tx.select().from(leadershipMatches).where(eq(leadershipMatches.id, matchId))
        if (!initial) return
        await tx.select({ id: leadershipChallenges.id }).from(leadershipChallenges).where(eq(leadershipChallenges.id, initial.challengeId)).for('no key update')
        const field = actorId === initial.whiteId ? leadershipMatches.whiteReadyAt : actorId === initial.blackId ? leadershipMatches.blackReadyAt : null
        if (!field) return
        await tx.update(leadershipMatches).set(actorId === initial.whiteId ? { whiteReadyAt: null } : { blackReadyAt: null }).where(and(eq(leadershipMatches.id, matchId), eq(leadershipMatches.result, 'pending'), eq(field, new Date(readyAt)), gt(leadershipMatches.joinDeadline, new Date())))
      })
    },
  }
}
export const leadershipRepository = createLeadershipRepository()
