import { Chess } from 'chess.js'

export function buildReplay(pgn) {
  const chess = new Chess()
  chess.loadPgn(pgn)
  const moves = chess.history({ verbose: true })
  return { positions: [moves[0]?.before ?? chess.fen(), ...moves.map(move => move.after)],
    moves: moves.map(move => ({ san: move.san, label: `${move.before.split(' ')[5]}${move.color === 'w' ? '.' : '...'} ${move.san}` })) }
}

export function playerOutcome(game, userId) {
  if (game.whiteId !== userId && game.blackId !== userId) return null
  if (game.result === 'draw') return 'Draw'
  return game.result === (game.whiteId === userId ? 'white' : 'black') ? 'Victory' : 'Defeat'
}
