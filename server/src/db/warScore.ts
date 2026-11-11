export function scoreWar(matches: { whiteId: string; blackId: string; result: string; endReason?: string | null }[], fighters: { userId: string; crewId: string }[], challengerId: string, defenderId: string) {
  let challengerScoreHalf = 0, defenderScoreHalf = 0
  const seen = new Set<string>()
  for (const match of matches) {
    const white = fighters.find(fighter => fighter.userId === match.whiteId)?.crewId
    const black = fighters.find(fighter => fighter.userId === match.blackId)?.crewId
    if (!white || !black || white === black || ![challengerId, defenderId].includes(white) || ![challengerId, defenderId].includes(black) || seen.has(match.whiteId) || seen.has(match.blackId)) throw new Error('Invalid war pairing roster')
    seen.add(match.whiteId); seen.add(match.blackId)
    if (match.result === 'pending' || ['both_absent', 'server_interrupted'].includes(match.endReason ?? '')) continue
    if (!['white', 'black', 'draw'].includes(match.result)) throw new Error('Invalid war board result')
    const whitePoints = match.result === 'draw' ? 1 : match.result === 'white' ? 2 : 0
    challengerScoreHalf += white === challengerId ? whitePoints : 2 - whitePoints
    defenderScoreHalf += white === defenderId ? whitePoints : 2 - whitePoints
  }
  return { challengerScoreHalf, defenderScoreHalf }
}
