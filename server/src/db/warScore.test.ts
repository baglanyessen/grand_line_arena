import { expect, test } from 'bun:test'
import { scoreWar } from './warScore'

test('war scoring follows crew membership across alternating colors and half-point draws', () => {
  const fighters = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map(userId => ({ userId, crewId: userId[0]! }))
  expect(scoreWar([{ whiteId: 'a1', blackId: 'b1', result: 'white' }, { whiteId: 'b2', blackId: 'a2', result: 'black' },
    { whiteId: 'a3', blackId: 'b3', result: 'draw' }], fighters, 'a', 'b')).toEqual({ challengerScoreHalf: 5, defenderScoreHalf: 1 })
  expect(scoreWar([{ whiteId: 'a1', blackId: 'b1', result: 'pending' }], fighters, 'a', 'b')).toEqual({ challengerScoreHalf: 0, defenderScoreHalf: 0 })
  expect(scoreWar([{ whiteId: 'a1', blackId: 'b1', result: 'draw', endReason: 'both_absent' }], fighters, 'a', 'b')).toEqual({ challengerScoreHalf: 0, defenderScoreHalf: 0 })
  expect(() => scoreWar([{ whiteId: 'a1', blackId: 'a2', result: 'white' }], fighters, 'a', 'b')).toThrow('Invalid war pairing')
})
