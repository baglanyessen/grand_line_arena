import test from 'node:test'
import assert from 'node:assert/strict'
import { Chess } from 'chess.js'
import { playLocalMove, undoLocalMove, needsPromotion, readGameSnapshot, receiveOnlineState, emptyOnlineGame, canSubmitMove } from './chessState.js'

function snapshot(game, extra = {}) {
  return { gameId: 'game-a', fen: game.fen(), pgn: game.pgn(), ply: game.history().length,
    turn: game.turn(), isGameOver: game.isGameOver(), drawOfferedBy: null,
    clock: { whiteMs: 300000, blackMs: 300000, initialMs: 300000, incrementMs: 0, revision: 1,
      running: (extra.isGameOver ?? game.isGameOver()) ? null : game.turn() }, ...extra }
}
function start(game = new Chess()) {
  return receiveOnlineState(emptyOnlineGame(), { type: 'game_start', color: 'w', ...snapshot(game) })
}

test('local moves preserve history and undo restores the exact previous position', () => {
  const initial = new Chess()
  const first = playLocalMove(initial, { from: 'e2', to: 'e4' })
  const second = playLocalMove(first, { from: 'e7', to: 'e5' })
  assert.deepEqual(second.history(), ['e4', 'e5'])
  assert.equal(initial.history().length, 0)
  assert.equal(undoLocalMove(second).fen(), first.fen())
  assert.deepEqual(undoLocalMove(second).history(), ['e4'])
  assert.equal(undoLocalMove(first).fen(), initial.fen())
  assert.equal(undoLocalMove(initial), null)
})

test('local threefold repetition survives cloning between moves', () => {
  let game = new Chess()
  for (let i = 0; i < 2; i++) for (const [from, to] of [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']])
    game = playLocalMove(game, { from, to })
  assert.equal(game.isThreefoldRepetition(), true)
  assert.equal(game.history().length, 8)
  assert.equal(undoLocalMove(game).isThreefoldRepetition(), false)
})

test('castling and en passant history survive cloning and undo', () => {
  let castle = new Chess()
  for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O']) castle = playLocalMove(castle, move)
  assert.equal(castle.get('g1').type, 'k')
  assert.equal(undoLocalMove(castle).get('e1').type, 'k')
  let game = new Chess()
  for (const move of ['e4', 'a6', 'e5', 'd5', 'exd6']) game = playLocalMove(game, move)
  assert.equal(game.get('d5'), undefined)
  const undone = undoLocalMove(game)
  assert.equal(undone.get('d5').type, 'p')
  assert.equal(undone.get('e5').type, 'p')
})

test('all four promotions work for both colors, including undo from a custom start', () => {
  for (const color of ['w', 'b']) for (const promotion of ['q', 'r', 'b', 'n']) {
    const game = new Chess(color === 'w' ? '7k/P7/8/8/8/8/7p/7K w - - 0 1' : '7k/P7/8/8/8/8/7p/7K b - - 0 1')
    const [from, to] = color === 'w' ? ['a7', 'a8'] : ['h2', 'h1']
    // Use a non-occupied promotion square for black.
    const source = color === 'b' ? new Chess('7k/P7/8/8/8/8/6p1/K7 b - - 0 1') : game
    const sourceFrom = color === 'b' ? 'g2' : from
    const sourceTo = color === 'b' ? 'g1' : to
    assert.equal(needsPromotion(source, sourceFrom, sourceTo), true)
    const result = playLocalMove(source, { from: sourceFrom, to: sourceTo, promotion })
    assert.equal(result.get(sourceTo).type, promotion)
    assert.equal(result.get(sourceTo).color, color)
    assert.equal(undoLocalMove(result).fen(), source.fen())
  }
})

test('snapshots reconstruct the position, move log and repetition state', () => {
  const game = new Chess()
  for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) game.move(san)
  const decoded = readGameSnapshot(snapshot(game))
  assert.equal(decoded.game.fen(), game.fen())
  assert.equal(decoded.moveHistory.length, 8)
  assert.equal(decoded.game.isThreefoldRepetition(), true)
})

test('conflicting snapshot fields are rejected instead of mixing history and position', () => {
  const game = new Chess()
  const before = snapshot(game)
  game.move('e4')
  assert.throws(() => readGameSnapshot({ ...before, fen: game.fen() }))
  assert.throws(() => readGameSnapshot({ ...snapshot(game), ply: 0 }))
  assert.throws(() => readGameSnapshot({ ...snapshot(game), turn: 'w' }))
})

test('submission does not mutate the board; confirmed echo and duplicate frames produce one move', () => {
  let online = start()
  const move = { from: 'e2', to: 'e4' }
  const original = online.snapshot.fen
  assert.equal(canSubmitMove(online, null, move), true)
  assert.equal(canSubmitMove(online, { requestId: 'pending' }, move), false)
  assert.equal(online.snapshot.fen, original)
  const server = new Chess(); server.move(move)
  const accepted = { type: 'move', ...snapshot(server) }
  online = receiveOnlineState(online, accepted)
  online = receiveOnlineState(online, accepted)
  assert.equal(online.snapshot.moveHistory.length, 1)
  assert.equal(online.snapshot.fen, server.fen())
})

test('a rejected move restores the server position and allows another legal request', () => {
  let online = start()
  online = { ...online, phase: 'syncing' }
  online = receiveOnlineState(online, { type: 'move_rejected', ...snapshot(new Chess()) })
  assert.equal(online.phase, 'playing')
  assert.equal(online.snapshot.moveHistory.length, 0)
  assert.equal(canSubmitMove(online, null, { from: 'd2', to: 'd4' }), true)
})

test('old frames, another game and duplicate start cannot roll the board back', () => {
  const initial = start()
  const game = new Chess(); game.move('e4')
  const online = receiveOnlineState(initial, { type: 'move', ...snapshot(game) })
  assert.equal(receiveOnlineState(online, { type: 'move', ...snapshot(new Chess()) }), online)
  assert.equal(receiveOnlineState(online, { type: 'move', ...snapshot(game, { gameId: 'other-game' }) }), online)
  assert.equal(receiveOnlineState(online, { type: 'game_start', color: 'w', ...snapshot(new Chess()) }), online)
})

test('resignation freezes a position even though chess.js itself sees no checkmate', () => {
  const initial = start()
  const ended = receiveOnlineState(initial, { type: 'game_over', ...snapshot(new Chess(), { isGameOver: true }), result: 'black', reason: 'resignation' })
  assert.equal(ended.phase, 'finished')
  assert.equal(ended.snapshot.game.isGameOver(), false)
  assert.equal(canSubmitMove(ended, null, { from: 'e2', to: 'e4' }), false)
  assert.equal(receiveOnlineState(ended, { type: 'game_state', ...snapshot(new Chess()) }), ended)
})

test('disconnected and syncing boards never turn into local play implicitly', () => {
  const initial = start()
  for (const phase of ['disconnected', 'syncing', 'finishing']) {
    const stopped = { ...initial, phase }
    assert.equal(canSubmitMove(stopped, null, { from: 'e2', to: 'e4' }), false)
    if (phase === 'disconnected') assert.equal(receiveOnlineState(stopped, { type: 'game_state', ...snapshot(new Chess()) }), stopped)
  }
})

test('turn ownership and explicit promotion are enforced before sending', () => {
  const initial = start()
  assert.equal(canSubmitMove({ ...initial, assignedColor: 'b' }, null, { from: 'e2', to: 'e4' }), false)
  assert.equal(canSubmitMove(initial, null, { from: 'e7', to: 'e5' }), false)
  const game = new Chess('7k/P7/8/8/8/8/8/7K w - - 0 1')
  const online = start(game)
  assert.equal(canSubmitMove(online, null, { from: 'a7', to: 'a8' }), false)
  assert.equal(canSubmitMove(online, null, { from: 'a7', to: 'a8', promotion: 'n' }), true)
})

test('a fresh page can restore a game with its original color and full history', () => {
  const game = new Chess(); game.move('e4'); game.move('e5')
  const resumed = receiveOnlineState(emptyOnlineGame(), { type: 'game_resumed', color: 'b',
    white: { id: 'opponent' }, ...snapshot(game, { presence: { w: true, b: true } }) })
  assert.equal(resumed.phase, 'playing')
  assert.equal(resumed.assignedColor, 'b')
  assert.equal(resumed.opponent.id, 'opponent')
  assert.deepEqual(resumed.snapshot.moveHistory.map(move => move.san), ['e4', 'e5'])
})

test('only an explicit resume message revives a disconnected game', () => {
  const disconnected = { ...start(), phase: 'disconnected' }
  const game = new Chess(); game.move('e4')
  const event = { type: 'game_state', ...snapshot(game) }
  assert.equal(receiveOnlineState(disconnected, event), disconnected)
  const restored = receiveOnlineState(disconnected, { ...event, type: 'game_resumed', color: 'w' })
  assert.equal(restored.phase, 'playing')
  assert.equal(restored.snapshot.ply, 1)
})

test('a result recovered after disconnect stays terminal even without checkmate', () => {
  const disconnected = { ...start(), phase: 'reconnecting' }
  const restored = receiveOnlineState(disconnected, { type: 'game_resumed', color: 'w', result: 'black', reason: 'abandonment',
    ...snapshot(new Chess(), { isGameOver: true }) })
  assert.equal(restored.phase, 'finished')
  assert.equal(restored.matchResult.result, 'black')
  assert.equal(canSubmitMove(restored, null, { from: 'e2', to: 'e4' }), false)
})

test('waiting for the durable journal freezes play without claiming the result is saved', () => {
  const finalizing = receiveOnlineState(start(), { type: 'game_finalizing', color: 'w',
    ...snapshot(new Chess(), { isGameOver: true }) })
  assert.equal(finalizing.phase, 'finishing')
  assert.equal(finalizing.matchResult, null)
  assert.equal(canSubmitMove(finalizing, null, { from: 'e2', to: 'e4' }), false)
  const ended = receiveOnlineState(finalizing, { type: 'game_over', result: 'black', reason: 'resignation', persistence: 'queued',
    ...snapshot(new Chess(), { isGameOver: true }) })
  assert.equal(ended.phase, 'finished')
  assert.equal(ended.matchResult.persistence, 'queued')
  assert.equal(receiveOnlineState(ended, { type: 'game_finalizing', color: 'w',
    ...snapshot(new Chess(), { isGameOver: true }) }), ended)
})
