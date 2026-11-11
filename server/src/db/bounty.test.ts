import { expect, test } from 'bun:test'
import { BOUNTY_POLICY, calculateBounty } from './bounty'

test('bounty respects floor, maximum, color and non-rewarded outcomes', () => {
  expect(calculateBounty('black', 20, BOUNTY_POLICY.max - 10, 4, 0)).toMatchObject({ whiteDelta: -20, blackDelta: 10, whiteAfter: 0, blackAfter: BOUNTY_POLICY.max })
  expect(calculateBounty('white', 0, 0, 4, 0)).toMatchObject({ whiteDelta: 100, blackDelta: 0 })
  for (const [result, plies, count, status] of [['draw', 4, 0, 'draw'], ['white', 3, 0, 'short_game'], ['black', 4, 3, 'pair_limit']] as const)
    expect(calculateBounty(result, 100, 100, plies, count)).toMatchObject({ whiteDelta: 0, blackDelta: 0, status })
})
