import { and, asc, eq, getTableColumns, ilike, sql, isNull, inArray, or } from 'drizzle-orm'
import { db } from './index'
import { crews, crewMembers, users, crewWars, warFighters, warMatches } from './schema'
import { crewTotalBounty } from './bounty'

export { CrewError } from './crewError'
import { CrewError } from './crewError'
import { guardLeadership } from './leadershipLifecycle'

export function createCrewRepository(database = db) {
  const crewFields = { ...getTableColumns(crews), totalBounty: crewTotalBounty() }
  async function releaseWarFighter(tx: Parameters<Parameters<typeof database.transaction>[0]>[0], userId: string, crewId: string) {
    const [paired] = await tx.select({ id: warMatches.id }).from(warMatches).innerJoin(crewWars, eq(crewWars.id, warMatches.warId))
      .where(and(eq(crewWars.status, 'active'), or(eq(crewWars.challengerCrewId, crewId), eq(crewWars.defenderCrewId, crewId)),
        or(eq(warMatches.whiteId, userId), eq(warMatches.blackId, userId)))).limit(1)
    if (paired) throw new CrewError(409, 'This fighter is assigned to an active war; resolve it before leaving or kicking')
    await tx.delete(warFighters).where(and(eq(warFighters.userId, userId), eq(warFighters.crewId, crewId),
      inArray(warFighters.warId, tx.select({ id: crewWars.id }).from(crewWars).where(eq(crewWars.status, 'active')))))
  }
  async function detail(crewId: string) {
    return database.transaction(async tx => {
      const [crew] = await tx.select(crewFields).from(crews).where(eq(crews.id, crewId)).limit(1)
      if (!crew) throw new CrewError(404, 'Crew not found')
      const members = await tx.select({ id: crewMembers.id, userId: users.id, username: users.username,
        role: crewMembers.role, joinedAt: crewMembers.joinedAt, bounty: users.bounty, avatarUrl: users.avatarUrl })
        .from(crewMembers).innerJoin(users, eq(crewMembers.userId, users.id))
        .where(eq(crewMembers.crewId, crewId)).orderBy(asc(crewMembers.joinedAt), asc(crewMembers.id))
      return { crew, members }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  }
  return {
    detail,
    async mine(userId: string) {
      const [membership] = await database.select().from(crewMembers).where(eq(crewMembers.userId, userId)).limit(1)
      if (!membership) return { crew: null, members: [], myRole: null }
      const result = await detail(membership.crewId)
      const current = result.members.find(member => member.userId === userId)
      return current ? { ...result, myRole: current.role } : { crew: null, members: [], myRole: null }
    },
    async list(search: string, limit: number, offset: number) {
      return database.select({ ...crewFields,
        memberCount: sql<number>`(SELECT count(*) FROM crew_members m WHERE m.crew_id = "crews"."id")`.mapWith(Number) })
        .from(crews).where(and(isNull(crews.disbandedAt), search ? ilike(crews.name, `%${search}%`) : undefined))
        .orderBy(asc(crews.name), asc(crews.id)).limit(limit).offset(offset)
    },
    async create(userId: string, input: { name: string; tag: string; description?: string }) {
      const name = input.name.trim(), tag = input.tag.trim().toUpperCase()
      if (name.length < 3 || tag.length < 2) throw new CrewError(400, 'Crew name and tag cannot be blank or too short')
      const id = await database.transaction(async tx => {
        // Serialize create/join for this account, including when no membership exists yet.
        const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update')
        if (!user) throw new CrewError(401, 'Account no longer exists')
        const [existing] = await tx.select({ id: crewMembers.id }).from(crewMembers).where(eq(crewMembers.userId, userId))
        if (existing) throw new CrewError(409, 'You are already in a crew')
        const [crew] = await tx.insert(crews).values({ name, tag, description: input.description?.trim() ?? '', captainId: userId }).returning({ id: crews.id })
        if (!crew) throw new Error('Crew insert failed')
        await tx.insert(crewMembers).values({ userId, crewId: crew.id, role: 'captain' })
        return crew.id
      })
      return detail(id)
    },
    async join(userId: string, crewId: string) {
      await database.transaction(async tx => {
        const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update')
        if (!user) throw new CrewError(401, 'Account no longer exists')
        const [existing] = await tx.select({ id: crewMembers.id }).from(crewMembers).where(eq(crewMembers.userId, userId))
        if (existing) throw new CrewError(409, 'You are already in a crew')
        // All roster mutations lock the crew before checking or changing membership.
        const [crew] = await tx.select().from(crews).where(eq(crews.id, crewId)).for('no key update')
        if (!crew) throw new CrewError(404, 'Crew not found')
        if (crew.disbandedAt) throw new CrewError(409, 'Crew has been disbanded')
        const [count] = await tx.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(crewMembers).where(eq(crewMembers.crewId, crewId))
        if ((count?.value ?? 0) >= crew.maxMembers) throw new CrewError(409, 'Crew is full')
        await tx.insert(crewMembers).values({ userId, crewId, role: 'member' })
      })
    },
    async leave(userId: string, crewId: string) {
      await database.transaction(async tx => {
        const [crew] = await tx.select().from(crews).where(eq(crews.id, crewId)).for('no key update')
        if (!crew) throw new CrewError(404, 'Crew not found')
        if (crew.disbandedAt) throw new CrewError(409, 'Crew has been disbanded')
        const [member] = await tx.select().from(crewMembers).where(and(eq(crewMembers.userId, userId), eq(crewMembers.crewId, crewId)))
        if (!member) throw new CrewError(409, 'You are not in this crew')
        if (member.role === 'captain' || crew.captainId === userId) throw new CrewError(409, 'The captain must remain in the crew')
        await guardLeadership(tx, crewId, userId)
        await releaseWarFighter(tx, userId, crewId)
        await tx.delete(crewMembers).where(eq(crewMembers.id, member.id))
      })
    },
    async setRole(actorId: string, crewId: string, targetId: string, role: 'member' | 'officer') {
      if (role !== 'member' && role !== 'officer') throw new CrewError(400, 'Invalid crew role')
      await database.transaction(async tx => {
        const [crew] = await tx.select().from(crews).where(eq(crews.id, crewId)).for('no key update')
        if (!crew) throw new CrewError(404, 'Crew not found')
        if (crew.disbandedAt) throw new CrewError(409, 'Crew has been disbanded')
        const roster = await tx.select().from(crewMembers).where(eq(crewMembers.crewId, crewId))
        const actor = roster.find(member => member.userId === actorId), target = roster.find(member => member.userId === targetId)
        if (crew.captainId !== actorId || actor?.role !== 'captain') throw new CrewError(403, 'Only the captain can change crew roles')
        if (!target) throw new CrewError(404, 'Member not found in crew')
        if (target.role === 'captain' || targetId === crew.captainId) throw new CrewError(409, 'Use captain transfer to change the captain')
        await tx.update(crewMembers).set({ role }).where(eq(crewMembers.id, target.id))
      })
    },
    async transferCaptain(actorId: string, crewId: string, targetId: string) {
      await database.transaction(async tx => {
        const [crew] = await tx.select().from(crews).where(eq(crews.id, crewId)).for('no key update')
        if (!crew) throw new CrewError(404, 'Crew not found')
        if (crew.disbandedAt) throw new CrewError(409, 'Crew has been disbanded')
        const roster = await tx.select().from(crewMembers).where(eq(crewMembers.crewId, crewId))
        const actor = roster.find(member => member.userId === actorId), target = roster.find(member => member.userId === targetId)
        if (crew.captainId !== actorId || actor?.role !== 'captain') throw new CrewError(403, 'Only the captain can transfer leadership')
        await guardLeadership(tx, crewId)
        if (targetId === actorId) throw new CrewError(400, 'Choose another crew member')
        if (!target) throw new CrewError(404, 'The new captain must be a current crew member')
        // Free the unique captain slot first. Other readers see the complete change only at commit.
        await tx.update(crewMembers).set({ role: 'officer' }).where(eq(crewMembers.id, actor.id))
        await tx.update(crewMembers).set({ role: 'captain' }).where(eq(crewMembers.id, target.id))
        await tx.update(crews).set({ captainId: targetId }).where(eq(crews.id, crewId))
      })
    },
    async disband(actorId: string, crewId: string) {
      await database.transaction(async tx => {
        const [crew] = await tx.select().from(crews).where(eq(crews.id, crewId)).for('no key update')
        if (!crew) throw new CrewError(404, 'Crew not found')
        if (crew.captainId !== actorId) throw new CrewError(403, 'Only the captain can disband the crew')
        await guardLeadership(tx, crewId)
        if (crew.disbandedAt) return // Safe retry after a committed response was lost.
        const [captain] = await tx.select().from(crewMembers).where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, actorId)))
        if (captain?.role !== 'captain') throw new CrewError(403, 'Only the captain can disband the crew')
        const [war] = await tx.select({ id: crewWars.id }).from(crewWars).where(and(
          or(eq(crewWars.challengerCrewId, crewId), eq(crewWars.defenderCrewId, crewId)), inArray(crewWars.status, ['pending', 'active']))).limit(1)
        if (war) throw new CrewError(409, 'Resolve pending and active wars before disbanding the crew')
        const [snapshot] = await tx.select({ total: crewTotalBounty() }).from(crews).where(eq(crews.id, crewId))
        await tx.update(crews).set({ disbandedAt: new Date(), totalBounty: snapshot?.total ?? 0 }).where(eq(crews.id, crewId))
        await tx.delete(crewMembers).where(eq(crewMembers.crewId, crewId))
      })
    },
    async kick(actorId: string, crewId: string, targetId: string) {
      await database.transaction(async tx => {
        const [crew] = await tx.select().from(crews).where(eq(crews.id, crewId)).for('no key update')
        if (!crew) throw new CrewError(404, 'Crew not found')
        if (crew.disbandedAt) throw new CrewError(409, 'Crew has been disbanded')
        const roster = await tx.select().from(crewMembers).where(eq(crewMembers.crewId, crewId))
        const actor = roster.find(member => member.userId === actorId), target = roster.find(member => member.userId === targetId)
        if (!actor || actor.role === 'member') throw new CrewError(403, 'Only captains and officers can kick members')
        if (targetId === actorId) throw new CrewError(400, 'You cannot kick yourself')
        if (!target) throw new CrewError(404, 'Member not found in crew')
        if (target.role === 'captain' || crew.captainId === targetId) throw new CrewError(403, 'Cannot kick the captain')
        if (actor.role === 'officer' && target.role === 'officer') throw new CrewError(403, 'Only the captain can kick an officer')
        await guardLeadership(tx, crewId, targetId)
        await releaseWarFighter(tx, targetId, crewId)
        await tx.delete(crewMembers).where(eq(crewMembers.id, target.id))
      })
    },
  }
}

export const crewRepository = createCrewRepository()
