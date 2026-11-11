import test from 'node:test'
import assert from 'node:assert/strict'
import { Chess } from 'chess.js'
import { PUZZLES, OPENINGS, ENDGAMES, openingLesson, firstStudentPosition, studyGame, attemptLesson, uciMove, endgameOutcome } from './training.js'

test('every published puzzle is legal and advertised mate endpoints really mate', () => {
  assert.equal(PUZZLES.length, 20)
  for (const lesson of PUZZLES) {
    const game = new Chess(lesson.fen)
    for (const move of lesson.solution) { assert(!game.isGameOver(), lesson.id); uciMove(game, move) }
    if (['checkmate', 'back-rank'].includes(lesson.theme)) assert(game.isCheckmate(), lesson.id)
    if (lesson.theme === 'promotion') assert(game.history({ verbose: true }).some(move => move.promotion), lesson.id)
  }
})
test('all opening drills can be completed from either side with deterministic opponent replies', () => {
  assert.equal(OPENINGS.length, 54)
  for (const entry of OPENINGS) for (const color of ['w', 'b']) {
    const lesson = openingLesson(entry, color)
    let moves = firstStudentPosition(lesson)
    while (moves.length < lesson.solution.length) {
      const uci = lesson.solution[moves.length]
      const result = attemptLesson(lesson, moves, { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) })
      assert(result.accepted, entry.name); assert(result.moves.length > moves.length); moves = result.moves
    }
    assert.equal(studyGame(lesson, moves).history().length, lesson.solution.length)
  }
})
test('a legal alternative leaves a drill untouched and is distinguished from an illegal move', () => {
  const lesson = openingLesson(OPENINGS[0]), moves = []
  const other = attemptLesson(lesson, moves, { from: 'e2', to: 'e3' })
  assert.equal(other.accepted, false); assert.equal(other.reason, 'different_line'); assert.deepEqual(moves, [])
  assert.equal(attemptLesson(lesson, moves, { from: 'e2', to: 'e5' }).reason, 'illegal')
  const correct = attemptLesson(lesson, moves, { from: 'e2', to: 'e4' })
  assert.equal(correct.complete, true); assert.deepEqual(studyGame(lesson, correct.moves).history(), ['e4', 'e5'])
})
test('endgame catalogue starts in nonterminal legal positions without inventing forced winning goals', () => {
  assert.equal(ENDGAMES.length, 16)
  for (const entry of ENDGAMES) {
    const game = new Chess(entry.fen); assert(!game.isGameOver(), entry.id)
    if (entry.goal === 'checkmate') {
      const enemy = game.board().flat().filter(piece => piece && piece.color !== game.turn())
      assert.equal(enemy.length, 1, entry.id); assert.equal(enemy[0].type, 'k')
    } else assert.equal(entry.goal, 'technique')
  }
})
test('endgame completion distinguishes winning mate, stalemate and a genuine promotion', () => {
  const mate = new Chess('7k/6Q1/5K2/8/8/8/8/8 b - - 0 1')
  assert.equal(endgameOutcome(mate, 'w', 'checkmate').success, true)
  assert.equal(endgameOutcome(mate, 'b', 'checkmate').success, false)
  const drawn = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')
  assert.equal(endgameOutcome(drawn, 'w', 'checkmate').success, false)
  assert.equal(endgameOutcome(drawn, 'b', 'draw').success, true)
  const promotion = new Chess('7k/P7/8/8/8/8/8/7K w - - 0 1'); promotion.move('a8=Q+')
  assert.equal(endgameOutcome(promotion, 'w', 'promote').success, true)
})
