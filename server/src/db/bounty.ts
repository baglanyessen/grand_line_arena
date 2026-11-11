import { Chess } from 'chess.js'
import { sql } from 'drizzle-orm'

export const BOUNTY_POLICY = { version: 1, win: 100, loss: 50, minPlies: 4, pairLimit: 3, max: 1_000_000_000_000 } as const

export function calculateBounty(result: 'white' | 'black' | 'draw', white: number, black: number, plies: number, previousPairAwards: number) {
  const status = result === 'draw' ? 'draw' : plies < BOUNTY_POLICY.minPlies ? 'short_game' :
    previousPairAwards >= BOUNTY_POLICY.pairLimit ? 'pair_limit' : 'awarded'
  const whiteDelta = status !== 'awarded' ? 0 : result === 'white' ? Math.min(BOUNTY_POLICY.win, BOUNTY_POLICY.max - white) : -Math.min(BOUNTY_POLICY.loss, white) || 0
  const blackDelta = status !== 'awarded' ? 0 : result === 'black' ? Math.min(BOUNTY_POLICY.win, BOUNTY_POLICY.max - black) : -Math.min(BOUNTY_POLICY.loss, black) || 0
  return { whiteDelta, blackDelta, whiteAfter: white + whiteDelta, blackAfter: black + blackDelta, status, policyVersion: BOUNTY_POLICY.version }
}

export function pgnPlies(pgn: string) {
  const chess = new Chess()
  chess.loadPgn(pgn)
  return chess.history().length
}

// Derive the total from distinct current users, so joining/leaving and reward commits cannot leave a stale cache.
export function crewTotalBounty() {
  return sql<number>`CASE WHEN "crews"."disbanded_at" IS NOT NULL THEN "crews"."total_bounty" ELSE
    (SELECT COALESCE(SUM(u.bounty), 0) FROM users u WHERE EXISTS
    (SELECT 1 FROM crew_members m WHERE m.user_id = u.id AND m.crew_id = "crews"."id")) END`.mapWith(Number)
}
