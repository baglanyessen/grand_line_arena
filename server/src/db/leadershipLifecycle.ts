import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from './index'
import { crews, crewMembers, leadershipChallenges, leadershipMatches } from './schema'
import { CrewError } from './crewError'
export type LeadershipTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export const LEADERSHIP_WINDOW_MS = 86400000

// Caller holds the crew row; all structural membership changes share this lock.
export async function guardLeadership(tx: LeadershipTx, crewId: string, userId?: string) {
  const [open] = await tx.select().from(leadershipChallenges).where(and(eq(leadershipChallenges.crewId, crewId), inArray(leadershipChallenges.status, ['pending', 'active']))).limit(1)
  if (open && (!userId || [open.challengerId, open.captainId].includes(userId))) throw new CrewError(409, 'Resolve the leadership challenge before changing its participants or captain')
}

export async function nextLeadershipRound(tx: LeadershipTx, challenge: typeof leadershipChallenges.$inferSelect, round: number) {
  await tx.insert(leadershipMatches).values({ challengeId: challenge.id, round,
    whiteId: round % 2 ? challenge.challengerId : challenge.captainId,
    blackId: round % 2 ? challenge.captainId : challenge.challengerId, joinDeadline: new Date(Date.now() + LEADERSHIP_WINDOW_MS) })
}

// Caller locks participant users, then the crew, then the challenge (same order as result persistence).
export async function settleLeadership(tx: LeadershipTx, challenge: typeof leadershipChallenges.$inferSelect) {
  if (challenge.status !== 'active') return
  const matches = await tx.select().from(leadershipMatches).where(eq(leadershipMatches.challengeId, challenge.id)).orderBy(asc(leadershipMatches.round))
  if (matches.some(match => match.result === 'pending')) return
  const [crew] = await tx.select().from(crews).where(eq(crews.id, challenge.crewId))
  const members = await tx.select().from(crewMembers).where(eq(crewMembers.crewId, challenge.crewId))
  const challenger = members.find(member => member.userId === challenge.challengerId), captain = members.find(member => member.userId === challenge.captainId)
  const endedAt = new Date(Math.max(...matches.map(match => match.endedAt?.getTime() ?? Date.now())))
  if (!crew || crew.disbandedAt || crew.captainId !== challenge.captainId || captain?.role !== 'captain' || !challenger) {
    await tx.update(leadershipChallenges).set({ status: 'cancelled', endReason: 'crew_changed', endedAt }).where(eq(leadershipChallenges.id, challenge.id)); return
  }
  let challengerScoreHalf = 0, captainScoreHalf = 0
  for (const match of matches) {
    if (['both_absent', 'server_interrupted'].includes(match.endReason ?? '')) {
      await tx.update(leadershipChallenges).set({ status: 'completed', winnerId: challenge.captainId, endReason: 'no_contest', endedAt,
        challengerScoreHalf, captainScoreHalf }).where(eq(leadershipChallenges.id, challenge.id)); return
    }
    const whitePoints = match.result === 'draw' ? 1 : match.result === 'white' ? 2 : 0
    challengerScoreHalf += match.whiteId === challenge.challengerId ? whitePoints : 2 - whitePoints
    captainScoreHalf += match.whiteId === challenge.captainId ? whitePoints : 2 - whitePoints
  }
  await tx.update(leadershipChallenges).set({ challengerScoreHalf, captainScoreHalf }).where(eq(leadershipChallenges.id, challenge.id))
  if (challengerScoreHalf < 4 && captainScoreHalf < 4 && matches.length < 3) { await nextLeadershipRound(tx, challenge, matches.length + 1); return }
  const winnerId = challengerScoreHalf > captainScoreHalf ? challenge.challengerId : challenge.captainId
  if (winnerId === challenge.challengerId) {
    await tx.update(crewMembers).set({ role: 'officer' }).where(eq(crewMembers.id, captain.id))
    await tx.update(crewMembers).set({ role: 'captain' }).where(eq(crewMembers.id, challenger.id))
    await tx.update(crews).set({ captainId: winnerId }).where(eq(crews.id, crew.id))
  }
  await tx.update(leadershipChallenges).set({ status: 'completed', winnerId, endedAt,
    endReason: challengerScoreHalf === captainScoreHalf ? 'captain_holds_tie' : 'series_won' }).where(eq(leadershipChallenges.id, challenge.id))
}
