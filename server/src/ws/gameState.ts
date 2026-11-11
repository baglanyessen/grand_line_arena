import type { Chess } from 'chess.js'
import { clockSnapshot, type ChessClock } from './clock'

export interface GameState {
  id: string
  chess: Chess
  drawOfferedBy: string | null
  acceptedRequests: Set<string>
  clock: ChessClock
}

export function snapshotGame(game: GameState, finished = game.chess.isGameOver(), now = performance.now()) {
  return {
    gameId: game.id,
    fen: game.chess.fen(),
    pgn: game.chess.pgn(),
    ply: game.chess.history().length,
    turn: game.chess.turn(),
    isGameOver: finished,
    drawOfferedBy: finished ? null : game.drawOfferedBy,
    clock: clockSnapshot(game.clock, now),
  }
}

export function applyMoveRequest(game: GameState, playerId: string, color: 'w' | 'b', data: Record<string, unknown>) {
  const reject = (code: string, message: string) => ({ ok: false as const, code, message })
  if (data.gameId !== game.id) return reject('wrong_game', 'This move belongs to another game')
  if (typeof data.requestId !== 'string' || !data.requestId.length || data.requestId.length > 80 ||
      !Number.isSafeInteger(data.ply) || (data.ply as number) < 0)
    return reject('invalid_request', 'Missing move request ID or position version')
  const key = `${playerId}:${data.requestId}`
  if (game.acceptedRequests.has(key)) return reject('duplicate_request', 'This move request was already processed')
  if (data.ply !== game.chess.history().length) return reject('stale_position', 'Position changed. Board synchronized.')
  if (game.chess.isGameOver()) return reject('game_finished', 'The game has ended')
  if (game.chess.turn() !== color) return reject('not_your_turn', 'Not your turn')
  if (typeof data.from !== 'string' || !/^[a-h][1-8]$/.test(data.from) ||
      typeof data.to !== 'string' || !/^[a-h][1-8]$/.test(data.to) ||
      (data.promotion !== undefined && !['q', 'r', 'b', 'n'].includes(data.promotion as string)))
    return reject('illegal_move', 'Illegal move')
  const candidates = game.chess.moves({ verbose: true }).filter(move => move.from === data.from && move.to === data.to)
  if (candidates.some(move => move.promotion) && data.promotion === undefined)
    return reject('promotion_required', 'Choose a promotion piece')
  if (data.promotion !== undefined && !candidates.some(move => move.promotion === data.promotion))
    return reject('illegal_move', 'Illegal move')
  try {
    const move = game.chess.move({ from: data.from, to: data.to, promotion: data.promotion as string | undefined })
    game.acceptedRequests.add(key)
    game.drawOfferedBy = null
    return { ok: true as const, move }
  } catch { return reject('illegal_move', 'Illegal move') }
}
