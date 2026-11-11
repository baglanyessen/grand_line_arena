import { expect, test } from 'bun:test'
import { Chess } from 'chess.js'
import { createClock, clockRemaining, clockSnapshot, expiredColor, switchClock, stopClock, timeoutOutcome } from './clock'

test('clock starts white immediately and charges elapsed time without interval drift', () => {
  const clock = createClock(300000, 100)
  expect(clockRemaining(clock, 35100)).toEqual({ whiteMs: 265000, blackMs: 300000 })
  expect(clockRemaining(clock, 35100)).toEqual({ whiteMs: 265000, blackMs: 300000 })
  expect(clock.whiteMs).toBe(300000)
})

test('switching charges only the mover, adds no increment and starts the opponent', () => {
  const clock = createClock(1000, 0)
  switchClock(clock, 'b', 250)
  expect(clockRemaining(clock, 600)).toEqual({ whiteMs: 750, blackMs: 650 })
  switchClock(clock, 'w', 600)
  expect(clockRemaining(clock, 700)).toEqual({ whiteMs: 650, blackMs: 650 })
})

test('deadline is inclusive, and delayed checks never make time negative', () => {
  const clock = createClock(1000, 0)
  expect(expiredColor(clock, 999)).toBeNull()
  expect(expiredColor(clock, 1000)).toBe('w')
  expect(clockRemaining(clock, 999999).whiteMs).toBe(0)
})

test('stop freezes both clocks and later samples cannot consume more time', () => {
  const clock = createClock(1000, 0)
  switchClock(clock, 'b', 100)
  stopClock(clock, 400)
  expect(clockRemaining(clock, 90000)).toEqual({ whiteMs: 900, blackMs: 700 })
  expect(clock.running).toBeNull()
  expect(expiredColor(clock, 90000)).toBeNull()
})

test('every outgoing sample has a newer revision but sampling does not reset the timer', () => {
  const clock = createClock(1000, 0)
  const first = clockSnapshot(clock, 200)
  const second = clockSnapshot(clock, 400)
  expect(second.revision).toBeGreaterThan(first.revision)
  expect(second.whiteMs).toBe(600)
  expect(clock.startedAt).toBe(0)
})

test('invalid time controls are rejected before matchmaking', () => {
  for (const value of [0, -1, NaN, Infinity, 1.5, 86400001]) expect(() => createClock(value, 0)).toThrow()
})

test('timeout against a bare king is drawn; an opponent pawn can still win', () => {
  const chess = new Chess('7k/8/8/8/8/8/P7/7K w - - 0 1')
  expect(timeoutOutcome(chess, 'w')).toEqual({ result: 'draw', reason: 'timeout_no_mating_material' })
  expect(timeoutOutcome(chess, 'b')).toEqual({ result: 'white', reason: 'timeout' })
})
