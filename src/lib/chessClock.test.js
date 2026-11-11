import test from 'node:test'
import assert from 'node:assert/strict'
import { readClock, remainingAt, formatClock, receiveClockTick } from './chessClock.js'
import { emptyOnlineGame, receiveOnlineState } from './chessState.js'
import { Chess } from 'chess.js'

const sample = (extra = {}) => ({ whiteMs: 300000, blackMs: 300000, initialMs: 300000, incrementMs: 0, running: 'w', revision: 1, ...extra })
function state() {
  const game = new Chess()
  return receiveOnlineState(emptyOnlineGame(), { type: 'game_start', gameId: 'a', pgn: game.pgn(), fen: game.fen(),
    turn: 'w', ply: 0, isGameOver: false, color: 'w', clock: sample() })
}

test('display counts from local receipt time, only for the running side', () => {
  const clock = { ...sample(), receivedAt: 1000 }
  assert.equal(remainingAt(clock, 'w', 2500), 298500)
  assert.equal(remainingAt(clock, 'b', 2500), 300000)
  assert.equal(remainingAt(clock, 'w', 999999), 0)
  assert.equal(remainingAt(clock, 'w', 0), 300000)
})

test('stopped clocks remain fixed and formatting does not round up to zero early', () => {
  const clock = { ...sample({ running: null, whiteMs: 1234 }), receivedAt: 0 }
  assert.equal(remainingAt(clock, 'w', 999999), 1234)
  assert.equal(formatClock(300000), '05:00')
  assert.equal(formatClock(1), '00:01')
  assert.equal(formatClock(0), '00:00')
  assert.equal(formatClock(-10), '00:00')
})

test('clock samples reject invalid times, mismatched turns and running terminal clocks', () => {
  for (const clock of [sample({ whiteMs: -1 }), sample({ blackMs: Infinity }), sample({ running: 'b' }),
    sample({ revision: NaN }), sample({ incrementMs: 5 }), sample({ whiteMs: 400000 })])
    assert.throws(() => readClock(clock, { turn: 'w', isGameOver: false }))
  assert.throws(() => readClock(sample(), { turn: 'w', isGameOver: true }))
  assert.doesNotThrow(() => readClock(sample({ running: null }), { turn: 'w', isGameOver: true }))
})

test('clock ticks update only clocks, preserving board, history and pending sync phase', () => {
  const before = { ...state(), phase: 'syncing' }
  const after = receiveClockTick(before, { gameId: 'a', ply: 0, clock: sample({ whiteMs: 299000, revision: 2 }) })
  assert.equal(after.snapshot.game, before.snapshot.game)
  assert.equal(after.snapshot.moveHistory, before.snapshot.moveHistory)
  assert.equal(after.snapshot.clock.whiteMs, 299000)
  assert.equal(after.phase, 'syncing')
})

test('old clock packets, other games and inactive sessions cannot restart a clock', () => {
  const before = state()
  for (const change of [{ gameId: 'other' }, { ply: 1 }, { clock: sample({ revision: 0 }) }, { clock: sample() }])
    assert.equal(receiveClockTick(before, { gameId: 'a', ply: 0, clock: sample({ revision: 2 }), ...change }), before)
  for (const phase of ['finished', 'finishing', 'disconnected']) {
    const stopped = { ...before, phase }
    assert.equal(receiveClockTick(stopped, { gameId: 'a', ply: 0, clock: sample({ revision: 2 }) }), stopped)
  }
})
