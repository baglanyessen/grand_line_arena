import { Chess } from 'chess.js'
import { readClock } from './chessClock.js'

// FEN alone loses undo/repetition history. PGN preserves the starting position and every move.
export function cloneGame(game) {
  const copy = new Chess()
  copy.loadPgn(game.pgn())
  return copy
}

export function playLocalMove(game, move) {
  const copy = cloneGame(game)
  copy.move(move)
  return copy
}

export function undoLocalMove(game) {
  const copy = cloneGame(game)
  return copy.undo() ? copy : null
}

export function needsPromotion(game, from, to) {
  return game.moves({ verbose: true }).some(move => move.from === from && move.to === to && move.promotion)
}

export function readGameSnapshot(data) {
  if (typeof data.gameId !== 'string' || typeof data.pgn !== 'string' || typeof data.fen !== 'string' ||
      !Number.isSafeInteger(data.ply) || data.ply < 0 || typeof data.isGameOver !== 'boolean')
    throw new Error('Invalid game snapshot')
  const game = new Chess()
  game.loadPgn(data.pgn)
  const moveHistory = game.history({ verbose: true })
  if (game.fen() !== data.fen || moveHistory.length !== data.ply || game.turn() !== data.turn ||
      (game.isGameOver() && !data.isGameOver)) throw new Error('Inconsistent game snapshot')
  return { gameId: data.gameId, game, moveHistory, fen: data.fen, ply: data.ply,
    isGameOver: data.isGameOver, drawOfferedBy: data.drawOfferedBy ?? null,
    clock: readClock(data.clock, data), presence: data.presence ?? { w: true, b: true } }
}

export const emptyOnlineGame = () => ({ gameId: null, snapshot: null, assignedColor: null, opponent: null, phase: 'idle', matchResult: null })

export function receiveOnlineState(current, data) {
  if (data.type === 'game_finalizing') {
    if (current.phase === 'finished' || (current.gameId && current.gameId !== data.gameId)) return current
    if (!['w', 'b'].includes(data.color) || !data.isGameOver) throw new Error('Invalid finalizing game')
    return { gameId: data.gameId, snapshot: readGameSnapshot(data), assignedColor: data.color,
      opponent: data.color === 'w' ? data.black : data.white, phase: 'finishing', matchResult: null }
  }
  if (data.type === 'game_resumed') {
    if (!['idle', 'disconnected', 'reconnecting', 'unavailable', 'finished'].includes(current.phase)) return current
    if (!['w', 'b'].includes(data.color)) throw new Error('Invalid player color')
    const snapshot = readGameSnapshot(data)
    return { gameId: data.gameId, snapshot, assignedColor: data.color,
      opponent: data.color === 'w' ? data.black : data.white,
      phase: snapshot.isGameOver ? 'finished' : 'playing', matchResult: snapshot.isGameOver ? data : null }
  }
  if (data.type === 'game_start') {
    if (current.gameId === data.gameId || (current.gameId && current.phase !== 'idle')) return current
    if (!['w', 'b'].includes(data.color)) throw new Error('Invalid player color')
    return { gameId: data.gameId, snapshot: readGameSnapshot(data), assignedColor: data.color,
      opponent: data.color === 'w' ? data.black : data.white, phase: 'playing', matchResult: null }
  }
  if (!current.gameId || data.gameId !== current.gameId || ['finished', 'disconnected', 'reconnecting', 'unavailable'].includes(current.phase)) return current
  if (data.ply < current.snapshot.ply) return current
  const snapshot = readGameSnapshot(data)
  if (snapshot.ply === current.snapshot.ply && snapshot.fen !== current.snapshot.fen) throw new Error('Conflicting position version')
  const finished = data.type === 'game_over'
  if (!finished && snapshot.ply === current.snapshot.ply && snapshot.clock.revision < current.snapshot.clock.revision)
    snapshot.clock = current.snapshot.clock
  return { ...current, snapshot, phase: finished ? 'finished' : snapshot.isGameOver ? 'finishing' : 'playing',
    matchResult: finished ? data : current.matchResult }
}

export function canSubmitMove(online, pending, move) {
  if (online.phase !== 'playing' || pending || !online.snapshot || online.snapshot.isGameOver ||
      online.snapshot.game.turn() !== online.assignedColor) return false
  return online.snapshot.game.moves({ verbose: true }).some(legal =>
    legal.from === move.from && legal.to === move.to && legal.promotion === move.promotion)
}
