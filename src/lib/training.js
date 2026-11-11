import { Chess } from 'chess.js'
import { PUZZLES, OPENINGS, ENDGAMES } from '../data/training/catalog.js'

export { PUZZLES, OPENINGS, ENDGAMES }
export function uciMove(game, uci) {
  return game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) })
}
export function openingLesson(opening, color = 'w') {
  const game = new Chess(), solution = []
  for (const san of opening.moves.split(/\s+/)) { const move = game.move(san); solution.push(`${move.from}${move.to}${move.promotion ?? ''}`) }
  return { id: `${opening.eco}-${OPENINGS.indexOf(opening)}`, title: opening.name, fen: new Chess().fen(), solution, theme: opening.category, difficulty: 'opening', description: opening.idea, playerColor: color }
}
export function studyGame(lesson, moves = []) {
  const game = new Chess(lesson.fen)
  for (const uci of moves) uciMove(game, uci)
  return game
}
// Exact lesson lines are drills, not a claim that other legal moves are losing.
export function attemptLesson(lesson, moves, move) {
  const game = studyGame(lesson, moves), uci = `${move.from}${move.to}${move.promotion ?? ''}`
  let played
  try { played = game.move(move) } catch { return { accepted: false, reason: 'illegal', moves } }
  const alternateMate = ['checkmate', 'back-rank'].includes(lesson.theme) && game.isCheckmate()
  if (uci !== lesson.solution[moves.length] && !alternateMate) return { accepted: false, reason: 'different_line', moves }
  const next = [...moves, uci], student = lesson.playerColor ?? new Chess(lesson.fen).turn()
  // Replies are deterministic and applied with the successful student move; no timer can leak into another lesson.
  while (!game.isGameOver() && game.turn() !== student && next.length < lesson.solution.length) {
    const reply = lesson.solution[next.length]; uciMove(game, reply); next.push(reply)
  }
  return { accepted: true, reason: null, moves: next, played, complete: alternateMate || next.length === lesson.solution.length }
}
export function firstStudentPosition(lesson) {
  const moves = [], game = new Chess(lesson.fen), student = lesson.playerColor ?? game.turn()
  while (game.turn() !== student && moves.length < lesson.solution.length) { const move = lesson.solution[moves.length]; uciMove(game, move); moves.push(move) }
  return moves
}
export function endgameOutcome(game, color, goal) {
  if (game.isCheckmate()) return { finished: true, success: goal !== 'draw' && game.turn() !== color, text: game.turn() !== color ? 'Checkmate. Session completed.' : 'Your king was checkmated. Reset and try again.' }
  if (game.isDraw()) return { finished: true, success: ['draw', 'technique'].includes(goal), text: goal === 'draw' ? 'Draw held. Goal completed.' : goal === 'technique' ? 'Practice session ended in a draw.' : 'The game is drawn. Reset to try for your goal.' }
  if (goal === 'promote' && game.history({ verbose: true }).some(move => move.color === color && move.promotion)) return { finished: true, success: true, text: 'Your pawn promoted. Goal completed.' }
  return { finished: false, success: false, text: goal === 'technique' ? 'Practise the technique; this exercise does not claim a proven winning result.' : '' }
}
