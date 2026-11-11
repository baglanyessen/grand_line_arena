import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from './index'
import { activeEngineOwner, activeGames, crews, leadershipChallenges, leadershipMatches, users } from './schema'
import { settleLeadership } from './leadershipLifecycle'

export function createLeadershipDeadlineProcessor(database = db) {
  async function expire(id: string, at = new Date(), protectedMatch: (id: string) => boolean = () => false, ownerToken?: string) {
    await database.transaction(async tx => {
      if (ownerToken) {
        const [owner] = await tx.select().from(activeEngineOwner).where(eq(activeEngineOwner.id, true)).for('share')
        if (owner?.token !== ownerToken) return
      }
      const [initial] = await tx.select().from(leadershipChallenges).where(eq(leadershipChallenges.id, id))
      if (!initial || !['pending', 'active'].includes(initial.status)) return
      // Acceptance can race this initial read: preserve the same lock order in both states.
      await tx.select({ id: users.id }).from(users).where(inArray(users.id, [initial.captainId, initial.challengerId])).orderBy(asc(users.id)).for('no key update')
      await tx.select({ id: crews.id }).from(crews).where(eq(crews.id, initial.crewId)).for('no key update')
      const [challenge] = await tx.select().from(leadershipChallenges).where(eq(leadershipChallenges.id, id)).for('no key update')
      if (challenge?.status === 'pending' && challenge.requestDeadline <= at) {
        await tx.update(leadershipChallenges).set({ status: 'expired', endedAt: challenge.requestDeadline, endReason: 'request_expired' }).where(eq(leadershipChallenges.id, id)); return
      }
      if (challenge?.status !== 'active') return
      const pending = await tx.select().from(leadershipMatches).where(and(eq(leadershipMatches.challengeId, id), eq(leadershipMatches.result, 'pending'))).for('no key update')
      for (const match of pending) {
        if (match.joinDeadline > at || protectedMatch(match.id)) continue
        const [saved] = await tx.select({ id: activeGames.id }).from(activeGames).where(eq(activeGames.id, match.id))
        if (saved) continue
        const white = !!match.whiteReadyAt, black = !!match.blackReadyAt
        await tx.update(leadershipMatches).set({ result: white !== black ? white ? 'white' : 'black' : 'draw', endedAt: match.joinDeadline,
          endReason: white && black ? 'server_interrupted' : white || black ? 'opponent_absent' : 'both_absent' }).where(eq(leadershipMatches.id, match.id))
        await settleLeadership(tx, challenge)
      }
    })
  }
  return { expire, async sweep(at = new Date(), protectedMatch: (id: string) => boolean = () => false, ownerToken?: string) {
    const due = await database.select({ id: leadershipChallenges.id }).from(leadershipChallenges).where(or(
      and(eq(leadershipChallenges.status, 'pending'), sql`${leadershipChallenges.requestDeadline} <= ${at.toISOString()}`),
      and(eq(leadershipChallenges.status, 'active'), sql`EXISTS (SELECT 1 FROM leadership_matches m WHERE m.challenge_id = "leadership_challenges"."id" AND m.result = 'pending' AND m.join_deadline <= ${at.toISOString()})`)))
    for (const row of due) try { await expire(row.id, at, protectedMatch, ownerToken) } catch { console.error(`[LEADERSHIP] Deadline processing failed for ${row.id}; retrying`) }
  } }
}
