export type ClockColor = 'w' | 'b'
export interface ChessClock {
  whiteMs: number
  blackMs: number
  initialMs: number
  running: ClockColor | null
  startedAt: number | null
  revision: number
}

export const DEFAULT_TIME_MS = 5 * 60 * 1000

export function createClock(initialMs: number, now: number): ChessClock {
  if (!Number.isSafeInteger(initialMs) || initialMs <= 0 || initialMs > 86_400_000)
    throw new Error('Initial clock time must be between 1 ms and 24 hours')
  return { whiteMs: initialMs, blackMs: initialMs, initialMs, running: 'w', startedAt: now, revision: 0 }
}

export function clockRemaining(clock: ChessClock, now: number) {
  const elapsed = clock.startedAt === null ? 0 : Math.max(0, now - clock.startedAt)
  return {
    whiteMs: Math.max(0, clock.whiteMs - (clock.running === 'w' ? elapsed : 0)),
    blackMs: Math.max(0, clock.blackMs - (clock.running === 'b' ? elapsed : 0)),
  }
}

function settle(clock: ChessClock, now: number) {
  Object.assign(clock, clockRemaining(clock, now))
  clock.startedAt = clock.running ? now : null
}

export function switchClock(clock: ChessClock, next: ClockColor, now: number) {
  settle(clock, now)
  clock.running = next
  clock.startedAt = now
}

export function stopClock(clock: ChessClock, now: number) {
  settle(clock, now)
  clock.running = null
  clock.startedAt = null
}

export function expiredColor(clock: ChessClock, now: number): ClockColor | null {
  const remaining = clockRemaining(clock, now)
  return clock.running && remaining[clock.running === 'w' ? 'whiteMs' : 'blackMs'] <= 0 ? clock.running : null
}

export function clockSnapshot(clock: ChessClock, now: number) {
  return { ...clockRemaining(clock, now), running: clock.running, initialMs: clock.initialMs,
    incrementMs: 0, revision: ++clock.revision }
}
import type { Chess } from 'chess.js'


export function timeoutOutcome(chess: Chess, loser: ClockColor) {
  const winner = loser === 'w' ? 'b' : 'w'
  // Deliberately limited project policy, not a full dead-position solver.
  const hasPiece = chess.board().flat().some(piece => piece?.color === winner && piece.type !== 'k')
  return { result: hasPiece ? (winner === 'w' ? 'white' as const : 'black' as const) : 'draw' as const,
    reason: hasPiece ? 'timeout' : 'timeout_no_mating_material' }
}
