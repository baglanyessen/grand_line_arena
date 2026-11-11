import { guardLeadership } from './leadershipLifecycle'
import { WAR_STAGE_MS } from './warDeadlines'
import { and, asc, desc, eq, getTableColumns, inArray, or, sql, gt } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from './index'
import { crews, crewMembers, crewWars, warFighters, warMatches, users, warSettlements, warRewards } from './schema'
import { CrewError } from './crewRepository'

export function createWarRepository(database = db) {
  return {
    async checkInForPlayer(actorId: string, matchId: string) {
      return database.transaction(async tx => {
        const [initial] = await tx.select().from(warMatches).where(eq(warMatches.id, matchId))
        if (!initial || ![initial.whiteId, initial.blackId].includes(actorId)) throw new CrewError(403, 'You are not assigned to this war match')
        const [war] = await tx.select().from(crewWars).where(eq(crewWars.id, initial.warId)).for('no key update')
        const [match] = await tx.select().from(warMatches).where(eq(warMatches.id, matchId)).for('no key update')
        if (!match || war?.status !== 'active' || match.result !== 'pending' || match.gameId || match.joinDeadline.getTime() <= Date.now()) throw new CrewError(409, 'The war match entry deadline has passed or the board has finished')
        const previous = actorId === match.whiteId ? match.whiteReadyAt : match.blackReadyAt
        const readyAt = new Date(Math.max(Date.now(), (previous?.getTime() ?? 0) + 1))
        await tx.update(warMatches).set(actorId === match.whiteId ? { whiteReadyAt: readyAt } : { blackReadyAt: readyAt }).where(eq(warMatches.id, matchId))
        return { id: match.id, whiteId: match.whiteId, blackId: match.blackId, readyAt: readyAt.toISOString(), joinDeadline: match.joinDeadline.toISOString() }
      })
    },
    async clearReady(actorId: string, matchId: string, readyAt: string) {
      await database.transaction(async tx => {
        const [initial] = await tx.select().from(warMatches).where(eq(warMatches.id, matchId))
        if (!initial) return
        await tx.select({ id: crewWars.id }).from(crewWars).where(eq(crewWars.id, initial.warId)).for('no key update')
        const field = actorId === initial.whiteId ? warMatches.whiteReadyAt : actorId === initial.blackId ? warMatches.blackReadyAt : null
        if (!field) return
        await tx.update(warMatches).set(actorId === initial.whiteId ? { whiteReadyAt: null } : { blackReadyAt: null })
          .where(and(eq(warMatches.id, matchId), eq(warMatches.result, 'pending'), eq(field, new Date(readyAt)), gt(warMatches.joinDeadline, new Date())))
      })
    },
    async matchForPlayer(actorId: string, matchId: string) {
      const [row] = await database.select({ match: warMatches, status: crewWars.status }).from(warMatches)
        .innerJoin(crewWars, eq(crewWars.id, warMatches.warId)).where(eq(warMatches.id, matchId))
      if (!row || ![row.match.whiteId, row.match.blackId].includes(actorId)) throw new CrewError(403, 'You are not assigned to this war match')
      if (row.status !== 'active' || row.match.result !== 'pending' || row.match.gameId) throw new CrewError(409, 'This war match is no longer available')
      if (row.match.joinDeadline.getTime() <= Date.now()) throw new CrewError(409, 'The war match entry deadline has passed')
      return { id: row.match.id, whiteId: row.match.whiteId, blackId: row.match.blackId }
    },
    async detailForPlayer(actorId: string, warId: string) {
      return database.transaction(async tx => {
        const [war] = await tx.select().from(crewWars).where(eq(crewWars.id, warId))
        if (!war) throw new CrewError(404, 'War not found')
        const [membership] = await tx.select().from(crewMembers).where(eq(crewMembers.userId, actorId))
        if (!membership || ![war.challengerCrewId, war.defenderCrewId].includes(membership.crewId)) throw new CrewError(403, 'Join a participating crew to view its war rosters')
        const fighters = await tx.select({ userId: warFighters.userId, crewId: warFighters.crewId, position: warFighters.position, username: users.username })
          .from(warFighters).innerJoin(users, eq(users.id, warFighters.userId)).where(eq(warFighters.warId, warId)).orderBy(asc(warFighters.position))
        const white = alias(users, 'white_fighter'), black = alias(users, 'black_fighter')
        const matches = await tx.select({ ...getTableColumns(warMatches), whiteName: white.username, blackName: black.username }).from(warMatches)
          .innerJoin(white, eq(white.id, warMatches.whiteId)).innerJoin(black, eq(black.id, warMatches.blackId))
          .where(eq(warMatches.warId, warId)).orderBy(asc(warMatches.boardNumber))
        const eligible = await tx.select({ userId: users.id, username: users.username }).from(crewMembers).innerJoin(users, eq(users.id, crewMembers.userId))
          .where(eq(crewMembers.crewId, membership.crewId)).orderBy(asc(users.username), asc(users.id))
        const [settlement] = await tx.select().from(warSettlements).where(eq(warSettlements.warId, warId))
        const rewards = await tx.select().from(warRewards).where(eq(warRewards.warId, warId))
        return { war, fighters, matches, eligible, myCrewId: membership.crewId, settlement: settlement ?? null, rewards }
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
    },
    async submitFighters(actorId: string, warId: string, fighterIds: string[]) {
      return database.transaction(async tx => {
        const [initial] = await tx.select().from(crewWars).where(eq(crewWars.id, warId))
        if (!initial) throw new CrewError(404, 'War not found')
        const sides = await tx.select().from(crews).where(inArray(crews.id, [initial.challengerCrewId, initial.defenderCrewId])).orderBy(asc(crews.id)).for('no key update')
        const own = sides.find(crew => crew.captainId === actorId)
        const [captain] = await tx.select().from(crewMembers).where(eq(crewMembers.userId, actorId))
        if (!own || own.disbandedAt || captain?.crewId !== own.id || captain.role !== 'captain') throw new CrewError(403, 'Only a current war captain can select fighters')
        const [war] = await tx.select().from(crewWars).where(eq(crewWars.id, warId)).for('no key update')
        if (war?.status !== 'active') throw new CrewError(409, 'Fighters can only be selected for an active war')
        if (war.rosterDeadline && war.rosterDeadline.getTime() <= Date.now()) {
          const paired = await tx.select({ id: warMatches.id }).from(warMatches).where(eq(warMatches.warId, warId)).limit(1)
          if (!paired.length) throw new CrewError(409, 'The roster deadline has passed')
        }
        if (fighterIds.length !== war.matchesPerSide || new Set(fighterIds).size !== fighterIds.length) throw new CrewError(400, `Select exactly ${war.matchesPerSide} distinct fighters`)
        const existing = await tx.select().from(warMatches).where(eq(warMatches.warId, warId))
        if (existing.length) {
          const saved = await tx.select().from(warFighters).where(and(eq(warFighters.warId, warId), eq(warFighters.crewId, own.id))).orderBy(asc(warFighters.position))
          if (saved.length !== fighterIds.length || saved.some((fighter, index) => fighter.userId !== fighterIds[index])) throw new CrewError(409, 'Pairings are already fixed; the roster cannot be changed')
          return { ready: true }
        }
        const members = await tx.select({ id: crewMembers.userId }).from(crewMembers).where(and(eq(crewMembers.crewId, own.id), inArray(crewMembers.userId, fighterIds)))
        if (members.length !== fighterIds.length) throw new CrewError(400, 'Every fighter must be a current member of your crew')
        await tx.delete(warFighters).where(and(eq(warFighters.warId, warId), eq(warFighters.crewId, own.id)))
        await tx.insert(warFighters).values(fighterIds.map((userId, position) => ({ warId, crewId: own.id, userId, position })))
        const all = await tx.select().from(warFighters).where(eq(warFighters.warId, warId)).orderBy(asc(warFighters.position))
        const challenger = all.filter(fighter => fighter.crewId === war.challengerCrewId), defender = all.filter(fighter => fighter.crewId === war.defenderCrewId)
        if (challenger.length !== war.matchesPerSide || defender.length !== war.matchesPerSide) return { ready: false }
        const current = await tx.select().from(crewMembers).where(inArray(crewMembers.userId, all.map(fighter => fighter.userId)))
        if (all.some(fighter => !current.some(member => member.userId === fighter.userId && member.crewId === fighter.crewId))) throw new CrewError(409, 'A selected fighter has left; update the roster')
        await tx.insert(warMatches).values(challenger.map((fighter, index) => ({ warId, boardNumber: index + 1, joinDeadline: new Date(Date.now() + WAR_STAGE_MS),
          whiteId: index % 2 ? defender[index]!.userId : fighter.userId, blackId: index % 2 ? fighter.userId : defender[index]!.userId })))
        return { ready: true }
      })
    },
    async listForPlayer(actorId: string, status: 'all' | 'pending' | 'active' | 'history', limit: number, offset: number) {
      const [membership] = await database.select({ crewId: crewMembers.crewId }).from(crewMembers).where(eq(crewMembers.userId, actorId))
      if (!membership) return []
      const challenger = alias(crews, 'challenger'), defender = alias(crews, 'defender')
      return database.select({ ...getTableColumns(crewWars), challengerName: challenger.name, challengerTag: challenger.tag,
        defenderName: defender.name, defenderTag: defender.tag, bonusStatus: warSettlements.status, boardsCreated: sql<boolean>`EXISTS (SELECT 1 FROM war_matches m WHERE m.war_id = "crew_wars"."id")` }).from(crewWars)
        .innerJoin(challenger, eq(challenger.id, crewWars.challengerCrewId))
        .innerJoin(defender, eq(defender.id, crewWars.defenderCrewId))
        .leftJoin(warSettlements, eq(warSettlements.warId, crewWars.id))
        .where(and(or(eq(crewWars.challengerCrewId, membership.crewId), eq(crewWars.defenderCrewId, membership.crewId)),
          status === 'all' ? undefined : status === 'history' ? inArray(crewWars.status, ['completed', 'cancelled']) : eq(crewWars.status, status)))
        .orderBy(desc(crewWars.startedAt), desc(crewWars.id)).limit(limit).offset(offset)
    },
    async closePending(actorId: string, warId: string, action: 'cancel' | 'decline') {
      await database.transaction(async tx => {
        const [initial] = await tx.select().from(crewWars).where(eq(crewWars.id, warId))
        if (!initial) throw new CrewError(404, 'War not found')
        const sides = await tx.select().from(crews).where(inArray(crews.id, [initial.challengerCrewId, initial.defenderCrewId]))
          .orderBy(asc(crews.id)).for('no key update')
        const sideId = action === 'cancel' ? initial.challengerCrewId : initial.defenderCrewId
        const side = sides.find(crew => crew.id === sideId)
        const [captain] = await tx.select().from(crewMembers).where(and(eq(crewMembers.userId, actorId), eq(crewMembers.crewId, sideId)))
        if (!side || side.disbandedAt || side.captainId !== actorId || captain?.role !== 'captain')
          throw new CrewError(403, action === 'cancel' ? 'Only the challenging captain can cancel this request' : 'Only the defending captain can decline this request')
        const [war] = await tx.select().from(crewWars).where(eq(crewWars.id, warId)).for('no key update')
        if (war?.status !== 'pending') throw new CrewError(409, 'Only pending war requests can be cancelled or declined')
        await tx.update(crewWars).set({ status: 'cancelled', endedAt: new Date() }).where(eq(crewWars.id, warId))
      })
    },
    async declare(actorId: string, defenderId: string, matchesPerSide = 5) {
      return database.transaction(async tx => {
        const [initial] = await tx.select().from(crewMembers).where(eq(crewMembers.userId, actorId))
        if (!initial || initial.role !== 'captain') throw new CrewError(403, 'Only captains can declare war')
        if (initial.crewId === defenderId) throw new CrewError(400, 'Cannot declare war on your own crew')
        // Same order for both orientations; disband and leadership changes also lock crew rows.
        const sides = await tx.select().from(crews).where(inArray(crews.id, [initial.crewId, defenderId])).orderBy(asc(crews.id)).for('no key update')
        const attacker = sides.find(crew => crew.id === initial.crewId), defender = sides.find(crew => crew.id === defenderId)
        if (!attacker || !defender) throw new CrewError(404, 'Crew not found')
        if (attacker.disbandedAt || defender.disbandedAt) throw new CrewError(409, 'Disbanded crews cannot enter wars')
        const [captain] = await tx.select().from(crewMembers).where(and(eq(crewMembers.userId, actorId), eq(crewMembers.crewId, attacker.id)))
        if (attacker.captainId !== actorId || captain?.role !== 'captain') throw new CrewError(403, 'Only the current captain can declare war')
        await guardLeadership(tx, attacker.id); await guardLeadership(tx, defender.id)
        const [existing] = await tx.select({ id: crewWars.id }).from(crewWars).where(and(
          or(and(eq(crewWars.challengerCrewId, attacker.id), eq(crewWars.defenderCrewId, defender.id)),
            and(eq(crewWars.challengerCrewId, defender.id), eq(crewWars.defenderCrewId, attacker.id))), inArray(crewWars.status, ['pending', 'active'])))
        if (existing) throw new CrewError(409, 'There is already an active or pending war between these crews')
        const [war] = await tx.insert(crewWars).values({ challengerCrewId: attacker.id, defenderCrewId: defender.id, matchesPerSide, requestDeadline: new Date(Date.now() + WAR_STAGE_MS) }).returning()
        return war!
      })
    },
    async accept(actorId: string, warId: string) {
      await database.transaction(async tx => {
        const [initial] = await tx.select().from(crewWars).where(eq(crewWars.id, warId))
        if (!initial) throw new CrewError(404, 'War not found')
        const sides = await tx.select().from(crews).where(inArray(crews.id, [initial.challengerCrewId, initial.defenderCrewId])).orderBy(asc(crews.id)).for('no key update')
        if (sides.length !== 2 || sides.some(crew => crew.disbandedAt)) throw new CrewError(409, 'Disbanded crews cannot enter wars')
        for (const side of sides) await guardLeadership(tx, side.id)
        const defender = sides.find(crew => crew.id === initial.defenderCrewId)!
        const [captain] = await tx.select().from(crewMembers).where(and(eq(crewMembers.userId, actorId), eq(crewMembers.crewId, defender.id)))
        if (defender.captainId !== actorId || captain?.role !== 'captain') throw new CrewError(403, 'Only the defending captain can accept war')
        const [war] = await tx.select().from(crewWars).where(eq(crewWars.id, warId)).for('no key update')
        if (war?.status !== 'pending') throw new CrewError(409, 'War is not pending')
        if (war.requestDeadline.getTime() <= Date.now()) throw new CrewError(409, 'The request deadline has passed')
        await tx.update(crewWars).set({ status: 'active', rosterDeadline: new Date(Date.now() + WAR_STAGE_MS) }).where(eq(crewWars.id, warId))
      })
    },
  }
}
export const warRepository = createWarRepository()
