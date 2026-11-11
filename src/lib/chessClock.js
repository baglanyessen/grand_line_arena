export function readClock(clock, { turn, isGameOver }) {
  if (!clock || !Number.isFinite(clock.whiteMs) || !Number.isFinite(clock.blackMs) ||
      clock.whiteMs < 0 || clock.blackMs < 0 || !Number.isSafeInteger(clock.initialMs) ||
      clock.initialMs <= 0 || clock.initialMs > 86_400_000 || clock.whiteMs > clock.initialMs ||
      clock.blackMs > clock.initialMs || clock.incrementMs !== 0 ||
      !Number.isSafeInteger(clock.revision) || clock.revision < 0 ||
      (isGameOver ? clock.running !== null : clock.running !== turn)) throw new Error('Invalid server clock')
  return { ...clock, receivedAt: performance.now() }
}

export function remainingAt(clock, color, now = performance.now()) {
  const base = color === 'w' ? clock.whiteMs : clock.blackMs
  return Math.max(0, base - (clock.running === color ? Math.max(0, now - clock.receivedAt) : 0))
}

export function formatClock(ms) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function receiveClockTick(current, data) {
  if (!current.snapshot || !['playing', 'syncing'].includes(current.phase) || data.gameId !== current.gameId ||
      data.ply !== current.snapshot.ply || data.clock?.revision <= current.snapshot.clock.revision) return current
  const clock = readClock(data.clock, { turn: current.snapshot.game.turn(), isGameOver: false })
  return { ...current, snapshot: { ...current.snapshot, clock } }
}
