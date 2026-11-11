import test from 'node:test'
import assert from 'node:assert/strict'
import { Chess } from 'chess.js'
import { buildReplay, playerOutcome } from './gameReplay.js'

test('replay preserves every position and move without changing the original game', () => {
  const chess = new Chess(), positions = [chess.fen()]
  for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']) { chess.move(move); positions.push(chess.fen()) }
  const replay = buildReplay(chess.pgn())
  assert.deepEqual(replay.positions, positions)
  assert.deepEqual(replay.moves.map(move => move.label), ['1. e4', '1... e5', '2. Nf3', '2... Nc6', '3. Bb5'])
})

test('replay handles zero moves and promotion from a custom black-to-move position', () => {
  const chess = new Chess('7k/8/8/8/8/8/p7/7K b - - 0 42')
  assert.deepEqual(buildReplay(chess.pgn()).positions, [chess.fen()])
  const initial = chess.fen(); chess.move({ from: 'a2', to: 'a1', promotion: 'n' })
  const replay = buildReplay(chess.pgn())
  assert.deepEqual(replay.positions, [initial, chess.fen()])
  assert.equal(replay.moves[0].label, '42... a1=N')
  assert.throws(() => buildReplay('1. DefinitelyNotAMove'))
})

test('history outcomes follow the viewing player, including draws', () => {
  const game = { whiteId: 'a', blackId: 'b', result: 'black' }
  assert.equal(playerOutcome(game, 'a'), 'Defeat')
  assert.equal(playerOutcome(game, 'b'), 'Victory')
  assert.equal(playerOutcome({ ...game, result: 'draw' }, 'a'), 'Draw')
  assert.equal(playerOutcome(game, 'outsider'), null)
})
