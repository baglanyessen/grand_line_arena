import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from './index'
import { crewWars, games, users, warFighters, warMatches, warRewards, warSettlements } from './schema'
import { BOUNTY_POLICY, pgnPlies } from './bounty'
import { scoreWar } from './warScore'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function reconcileWar(tx: Tx, warId: string) {
  const boards = await tx.select().from(warMatches).where(eq(warMatches.warId, warId))
  const ids = [...new Set(boards.flatMap(board => [board.whiteId, board.blackId]))].sort()
  if (!ids.length) return
  await tx.select({ id: users.id }).from(users).where(inArray(users.id, ids)).orderBy(users.id).for('no key update')
  const [war] = await tx.select().from(crewWars).where(eq(crewWars.id, warId)).for('no key update')
  if (war?.status === 'active') await settleWar(tx, war)
}

// Caller holds the war row and all assigned user rows. No crew locks are acquired here.
export async function settleWar(tx: Tx, war: typeof crewWars.$inferSelect) {
  const matches = await tx.select().from(warMatches).where(eq(warMatches.warId, war.id))
  const fighters = await tx.select().from(warFighters).where(eq(warFighters.warId, war.id))
  if (matches.length !== war.matchesPerSide || fighters.length !== war.matchesPerSide * 2) throw new Error('Incomplete war pairing data')
  const score = scoreWar(matches, fighters, war.challengerCrewId, war.defenderCrewId)
  await tx.update(crewWars).set(score).where(eq(crewWars.id, war.id))
  if (matches.some(match => match.result === 'pending')) return
  const played = matches.filter(match => match.gameId)
  const records = played.length ? await tx.select({ pgn: games.pgn, endedAt: games.endedAt }).from(games).where(inArray(games.id, played.map(match => match.gameId!))) : []
  if (records.length !== played.length || records.some(game => !game.endedAt)) throw new Error('Missing completed war games')
  const settledAt = new Date(), day = new Date(settledAt); day.setUTCHours(0, 0, 0, 0)
  const [prior] = await tx.select({ id: warSettlements.warId }).from(warSettlements).innerJoin(crewWars, eq(crewWars.id, warSettlements.warId))
    .where(and(eq(warSettlements.status, 'awarded'), inArray(crewWars.challengerCrewId, [war.challengerCrewId, war.defenderCrewId]),
      inArray(crewWars.defenderCrewId, [war.challengerCrewId, war.defenderCrewId]), gte(warSettlements.settledAt, day),
      lt(warSettlements.settledAt, new Date(day.getTime() + 86400000)))).limit(1)
  const status = matches.some(match => ['opponent_absent', 'both_absent', 'server_interrupted'].includes(match.endReason ?? '')) ? 'forfeit' : records.some(game => pgnPlies(game.pgn) < BOUNTY_POLICY.minPlies) ? 'short_games' : prior ? 'pair_limit' : 'awarded'
  const winnerCrewId = score.challengerScoreHalf === score.defenderScoreHalf ? null :
    score.challengerScoreHalf > score.defenderScoreHalf ? war.challengerCrewId : war.defenderCrewId
  await tx.insert(warSettlements).values({ warId: war.id, status, policyVersion: 1, settledAt })
  const accounts = await tx.select({ id: users.id, bounty: users.bounty }).from(users).where(inArray(users.id, fighters.map(fighter => fighter.userId)))
  for (const fighter of fighters) {
    const account = accounts.find(account => account.id === fighter.userId)
    if (!account) throw new Error('Missing war fighter account')
    const nominal = status !== 'awarded' ? 0 : !winnerCrewId ? 100 : fighter.crewId === winnerCrewId ? 200 : 0
    const delta = Math.min(nominal, BOUNTY_POLICY.max - account.bounty)
    await tx.insert(warRewards).values({ warId: war.id, userId: account.id, crewId: fighter.crewId, delta, bountyAfter: account.bounty + delta })
    if (delta) await tx.update(users).set({ bounty: account.bounty + delta, bountyVersion: sql`${users.bountyVersion} + 1` }).where(eq(users.id, account.id))
  }
  await tx.update(crewWars).set({ status: 'completed', winnerCrewId, endReason: status === 'forfeit' ? 'board_forfeit' : 'played',
    endedAt: new Date(Math.max(...records.map(game => game.endedAt!.getTime()), ...matches.filter(match => match.endedAt).map(match => match.endedAt!.getTime()))) }).where(eq(crewWars.id, war.id))
}
