import { afterEach, expect, test } from 'bun:test'
import { jwt } from '@elysiajs/jwt'
import { authJwt } from '../auth/jwt'
import { createChessWs, type AuthenticatedPlayer } from './chess'
import { readGameSnapshot } from '../../../src/lib/chessState.js'

const alice = { id: crypto.randomUUID(), username: 'Alice', rating: 1400, bounty: 500, bountyVersion: 2 }
const bob = { id: crypto.randomUUID(), username: 'Bob', rating: 1600, bounty: 250, bountyVersion: 1 }
const carol = { id: crypto.randomUUID(), username: 'Carol', rating: 1200, bounty: 0, bountyVersion: 0 }
const players = new Map<string, AuthenticatedPlayer>([alice, bob, carol].map(player => [player.id, player]))
let app: ReturnType<typeof createChessWs> | undefined

class Peer {
  messages: any[] = []
  waiters: (() => void)[] = []
  socket: WebSocket
  version: { gameId: string; ply: number } | null = null
  opened: Promise<void>
  closed: Promise<number>

  constructor(url: string) {
    this.socket = new WebSocket(url)
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true })
      this.socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true })
    })
    this.closed = new Promise(resolve => this.socket.addEventListener('close', event => resolve(event.code), { once: true }))
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (['game_start', 'game_resumed', 'move', 'game_state', 'move_rejected', 'game_over'].includes(message.type))
        this.version = { gameId: message.gameId, ply: message.ply }
      this.messages.push(message)
      for (const check of [...this.waiters]) check()
    })
  }

  send(data: any) {
    if (data === null) { this.socket.send('null'); return }
    const command = data && ['move', 'resign', 'draw_offer', 'draw_accept', 'draw_decline', 'sync_game'].includes(data.type)
    const defaults = command && this.version ? { ...this.version, requestId: crypto.randomUUID() } : {}
    this.socket.send(JSON.stringify({ ...defaults, ...data }))
  }

  next(type: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const remove = () => { this.waiters = this.waiters.filter(waiter => waiter !== check) }
      const timeout = setTimeout(() => { remove(); reject(new Error(`Timed out waiting for ${type}`)) }, 2500)
      const check = () => {
        const index = this.messages.findIndex(message => message.type === type)
        if (index === -1) return
        clearTimeout(timeout)
        remove()
        resolve(this.messages.splice(index, 1)[0])
      }
      this.waiters.push(check)
      check()
    })
  }

  async authenticate(player: AuthenticatedPlayer, claims: Record<string, any> = {}) {
    const token = await authJwt.decorator.jwt.sign({ sub: player.id, username: 'Stale token name', ...claims })
    this.send({ type: 'authenticate', token })
    return this.next('authenticated')
  }

  async close() {
    if (this.socket.readyState !== WebSocket.CLOSED) this.socket.close()
    await this.closed
  }
}

const peers: Peer[] = []
function start(options: Parameters<typeof createChessWs>[0] = {}) {
  app = createChessWs({ activeStore: { load: () => [], save() {}, remove() {} }, findPlayer: async id => players.get(id) ?? null,
    resultSink: { start() {}, enqueue() {}, async stop() {} }, ...options })
    .listen({ hostname: '127.0.0.1', port: 0 })
}

async function connect() {
  const peer = new Peer(`ws://127.0.0.1:${app!.server!.port}/ws/chess`)
  peers.push(peer)
  await peer.opened
  return peer
}

async function match() {
  const a = await connect()
  const b = await connect()
  await a.authenticate(alice)
  await b.authenticate(bob)
  a.send({ type: 'join_queue', userId: carol.id, username: 'Forged', rating: 999999 })
  await a.next('queue_joined')
  b.send({ type: 'join_queue' })
  const info = await a.next('game_start')
  await b.next('game_start')
  expect([info.white, info.black].sort((x, y) => x.username.localeCompare(y.username))).toEqual([alice, bob])
  return { white: info.color === 'w' ? a : b, black: info.color === 'w' ? b : a, info }
}

afterEach(async () => {
  await Promise.all(peers.splice(0).map(peer => peer.close()))
  await app?.stop(true)
  app = undefined
})

test('all game commands require authentication before any player lookup', async () => {
  let lookups = 0
  start({ findPlayer: async () => { lookups++; return alice } })
  for (const type of ['join_queue', 'leave_queue', 'move', 'resign', 'draw_offer', 'draw_accept']) {
    const peer = await connect()
    peer.send({ type, userId: alice.id, username: alice.username, from: 'e2', to: 'e4' })
    expect((await peer.next('error')).code).toBe('authentication_required')
    expect(await peer.closed).toBe(1008)
  }
  expect(lookups).toBe(0)
})

test('rejects malformed, forged, expired and incomplete tokens', async () => {
  start()
  const wrongSigner = jwt({ name: 'other', secret: 'different-test-signing-secret' }).decorator.other
  const tokens = [
    'not-a-token',
    await wrongSigner.sign({ sub: alice.id, exp: '1h' }),
    await authJwt.decorator.jwt.sign({ sub: alice.id, exp: Math.floor(Date.now() / 1000) - 60 }),
    await authJwt.decorator.jwt.sign({ sub: alice.id, exp: undefined }),
    await authJwt.decorator.jwt.sign({ username: 'No subject' }),
    await authJwt.decorator.jwt.sign({ sub: 'not-a-uuid' }),
    await authJwt.decorator.jwt.sign({ sub: crypto.randomUUID() }),
  ]
  for (const token of tokens) {
    const peer = await connect()
    peer.send({ type: 'authenticate', token })
    expect((await peer.next('error')).code).toBe('authentication_failed')
    expect(await peer.closed).toBe(1008)
  }
})

test('authenticates with current server profile, not the token username', async () => {
  start()
  const peer = await connect()
  const response = await peer.authenticate(alice)
  expect(response.user).toEqual(alice)
  expect(response.token).toBeUndefined()
  peer.send({ type: 'join_queue' })
  expect((await peer.next('queue_joined')).type).toBe('queue_joined')
})

test('identity spoofing cannot move for an opponent or erase an active game', async () => {
  start()
  const { white, black, info } = await match()
  black.send({ type: 'move', userId: info.white.id, from: 'e2', to: 'e4' })
  expect((await black.next('move_rejected')).message).toBe('Not your turn')
  white.send({ type: 'join_queue' })
  expect((await white.next('error')).message).toBe('Already in a game')
  white.send({ type: 'move', from: 'e2', to: 'e4' })
  expect((await white.next('move')).move.san).toBe('e4')
  expect((await black.next('move')).move.san).toBe('e4')
  // A forged resignation still acts as the authenticated black player.
  black.send({ type: 'resign', userId: info.white.id })
  expect((await white.next('game_over')).result).toBe('white')
})

test('a third player cannot resign, draw or move in somebody else\'s game', async () => {
  start()
  const { white, black, info } = await match()
  const outsider = await connect()
  await outsider.authenticate(carol)
  for (const type of ['resign', 'draw_offer', 'draw_accept', 'move']) {
    outsider.send({ type, userId: info.white.id, from: 'e2', to: 'e4' })
    outsider.send({ type: 'barrier' })
    // Commands above are processed synchronously before the unknown-type response.
    const first = await outsider.next('error')
    if (!first.message.startsWith('Unknown type:')) await outsider.next('error')
  }
  white.send({ type: 'move', from: 'e2', to: 'e4' })
  await white.next('move')
  await black.next('move')
  expect(white.messages.some(message => ['game_over', 'draw_offered'].includes(message.type))).toBe(false)
  expect(black.messages.some(message => ['game_over', 'draw_offered'].includes(message.type))).toBe(false)
})

test('a forged leave-queue command cannot remove another player', async () => {
  start()
  const a = await connect()
  const b = await connect()
  await a.authenticate(alice)
  await b.authenticate(bob)
  a.send({ type: 'join_queue' })
  await a.next('queue_joined')
  b.send({ type: 'leave_queue', userId: alice.id })
  b.send({ type: 'join_queue' })
  await a.next('game_start')
  await b.next('game_start')
})

test('a second socket cannot take over the same account', async () => {
  start()
  const original = await connect()
  await original.authenticate(alice)
  const second = await connect()
  second.send({ type: 'authenticate', token: await authJwt.decorator.jwt.sign({ sub: alice.id }) })
  expect((await second.next('error')).code).toBe('duplicate_connection')
  expect(await second.closed).toBe(1008)
  original.send({ type: 'join_queue' })
  await original.next('queue_joined')
  await original.close()
  const replacement = await connect()
  await replacement.authenticate(alice)
  replacement.send({ type: 'join_queue' })
  await replacement.next('queue_joined')
})

test('no command runs while database authentication is pending', async () => {
  const lookup = Promise.withResolvers<AuthenticatedPlayer | null>()
  const started = Promise.withResolvers<void>()
  start({ findPlayer: async () => { started.resolve(); return lookup.promise } })
  const peer = await connect()
  peer.send({ type: 'authenticate', token: await authJwt.decorator.jwt.sign({ sub: alice.id }) })
  await started.promise
  peer.send({ type: 'join_queue' })
  expect((await peer.next('error')).code).toBe('authentication_pending')
  lookup.resolve(alice)
  await peer.next('authenticated')
  peer.send({ type: 'join_queue' })
  await peer.next('queue_joined')
})

test('a disconnected lookup cannot reserve the account later', async () => {
  const lookup = Promise.withResolvers<AuthenticatedPlayer | null>()
  const started = Promise.withResolvers<void>()
  let first = true
  start({ findPlayer: async () => {
    if (!first) return alice
    first = false
    started.resolve()
    return lookup.promise
  } })
  const old = await connect()
  old.send({ type: 'authenticate', token: await authJwt.decorator.jwt.sign({ sub: alice.id }) })
  await started.promise
  await old.close()
  lookup.resolve(alice)
  const fresh = await connect()
  await fresh.authenticate(alice)
})

test('idle unauthenticated sockets time out', async () => {
  start({ authTimeoutMs: 50 })
  const peer = await connect()
  expect((await peer.next('error')).code).toBe('authentication_timeout')
  expect(await peer.closed).toBe(1008)
})

test('a timed-out lookup cannot authenticate or block a fresh connection', async () => {
  const lookup = Promise.withResolvers<AuthenticatedPlayer | null>()
  const started = Promise.withResolvers<void>()
  let first = true
  start({ authTimeoutMs: 100, findPlayer: async () => {
    if (!first) return alice
    first = false
    started.resolve()
    return lookup.promise
  } })
  const slow = await connect()
  slow.send({ type: 'authenticate', token: await authJwt.decorator.jwt.sign({ sub: alice.id }) })
  await started.promise
  expect((await slow.next('error')).code).toBe('authentication_timeout')
  expect(await slow.closed).toBe(1008)
  lookup.resolve(alice)
  const fresh = await connect()
  await fresh.authenticate(alice)
})

test('an authenticated socket cannot switch accounts with a second token', async () => {
  start()
  const peer = await connect()
  await peer.authenticate(alice)
  peer.send({ type: 'authenticate', token: await authJwt.decorator.jwt.sign({ sub: bob.id }) })
  expect((await peer.next('error')).code).toBe('already_authenticating')
  peer.send({ type: 'join_queue' })
  await peer.next('queue_joined')
  const opponent = await connect()
  await opponent.authenticate(bob)
  opponent.send({ type: 'join_queue' })
  const info = await peer.next('game_start')
  expect([info.white.id, info.black.id].sort()).toEqual([alice.id, bob.id].sort())
})

test('database failures reject authentication without leaking error details', async () => {
  start({ findPlayer: async () => { throw new Error('private database details') } })
  const peer = await connect()
  peer.send({ type: 'authenticate', token: await authJwt.decorator.jwt.sign({ sub: alice.id }) })
  const response = await peer.next('error')
  expect(response.code).toBe('authentication_unavailable')
  expect(JSON.stringify(response)).not.toContain('private database details')
  expect(await peer.closed).toBe(1011)
})

test('an authenticated connection cannot keep playing after token expiry', async () => {
  start()
  const peer = await connect()
  await peer.authenticate(alice, { exp: Math.floor(Date.now() / 1000) + 2 })
  peer.send({ type: 'join_queue' })
  await peer.next('queue_joined')
  await Bun.sleep(2100)
  peer.send({ type: 'join_queue' })
  expect((await peer.next('error')).code).toBe('authentication_expired')
  expect(await peer.closed).toBe(1008)
})

test('malformed input and illegal moves leave the authenticated game usable', async () => {
  start()
  const { white, black } = await match()
  white.send(null)
  expect((await white.next('error')).code).toBe('invalid_message')
  white.send({ type: 'move', from: 'e2', to: 'e5' })
  expect((await white.next('move_rejected')).message).toBe('Illegal move')
  white.send({ type: 'move', from: 'e2', to: 'e4' })
  await white.next('move')
  await black.next('move')
})

// Synchronization regression cases use the same real WebSocket harness.
async function play(white: Peer, black: Peer, actor: Peer, from: string, to: string, promotion?: string) {
  actor.send({ type: 'move', from, to, promotion })
  const a = await white.next('move')
  const b = await black.next('move')
  expect(a).toEqual(b)
  expect(readGameSnapshot(a).moveHistory.length).toBe(a.ply)
  return a
}

test('both clients receive one identical snapshot per accepted move, including full history', async () => {
  start()
  const { white, black, info } = await match()
  expect(info.ply).toBe(0)
  expect(readGameSnapshot(info).moveHistory.length).toBe(0)
  const first = await play(white, black, white, 'e2', 'e4')
  expect(first.ply).toBe(1)
  expect(first.pgn).toContain('e4')
  const second = await play(white, black, black, 'e7', 'e5')
  expect(second.ply).toBe(2)
  expect(second.pgn).toContain('e4 e5')
  expect(second.gameId).toBe(info.gameId)
})

test('duplicate request IDs cannot produce another move even on a later turn', async () => {
  start()
  const { white, black } = await match()
  const requestId = crypto.randomUUID()
  white.send({ type: 'move', requestId, from: 'e2', to: 'e4' })
  await white.next('move'); await black.next('move')
  await play(white, black, black, 'e7', 'e5')
  white.send({ type: 'move', requestId, from: 'g1', to: 'f3' })
  const rejected = await white.next('move_rejected')
  expect(rejected.code).toBe('duplicate_request')
  expect(rejected.ply).toBe(2)
  expect((await play(white, black, white, 'g1', 'f3')).ply).toBe(3)
})

test('stale positions and wrong game IDs return the current board without a move', async () => {
  start()
  const { white, black } = await match()
  const current = await play(white, black, white, 'e2', 'e4')
  black.send({ type: 'move', ply: 0, from: 'e7', to: 'e5' })
  const stale = await black.next('move_rejected')
  expect(stale.code).toBe('stale_position')
  expect(stale.fen).toBe(current.fen)
  expect(stale.pgn).toBe(current.pgn)
  black.send({ type: 'move', gameId: crypto.randomUUID(), from: 'e7', to: 'e5' })
  expect((await black.next('move_rejected')).code).toBe('wrong_game')
  black.send({ type: 'sync_game' })
  const recovered = await black.next('game_state')
  expect(recovered.fen).toBe(current.fen)
  expect(recovered.ply).toBe(1)
  expect((await play(white, black, black, 'e7', 'e5')).ply).toBe(2)
})

test('moves require a request ID and position version', async () => {
  start()
  const { white } = await match()
  white.send({ type: 'move', requestId: undefined, from: 'e2', to: 'e4' })
  expect((await white.next('move_rejected')).code).toBe('invalid_request')
  white.send({ type: 'move', ply: undefined, from: 'e2', to: 'e4' })
  const rejected = await white.next('move_rejected')
  expect(rejected.code).toBe('invalid_request')
  expect(rejected.ply).toBe(0)
})

test('promotion must be explicit and both white and black underpromotion are preserved', async () => {
  start()
  const { white, black } = await match()
  for (const [actor, from, to] of [
    [white, 'a2', 'a4'], [black, 'h7', 'h5'], [white, 'a4', 'a5'], [black, 'h5', 'h4'],
    [white, 'a5', 'a6'], [black, 'h4', 'h3'], [white, 'a6', 'b7'], [black, 'h3', 'g2'],
  ] as const) await play(white, black, actor, from, to)
  white.send({ type: 'move', from: 'b7', to: 'a8' })
  const missing = await white.next('move_rejected')
  expect(missing.code).toBe('promotion_required')
  expect(missing.ply).toBe(8)
  const promoted = await play(white, black, white, 'b7', 'a8', 'n')
  expect(promoted.move.promotion).toBe('n')
  expect(promoted.pgn).toContain('bxa8=N')
  const blackPromoted = await play(white, black, black, 'g2', 'h1', 'r')
  expect(blackPromoted.move.promotion).toBe('r')
  expect(blackPromoted.pgn).toContain('gxh1=R')
})

test('checkmate emits a final snapshot to both clients and rejects later moves', async () => {
  start()
  const { white, black } = await match()
  await play(white, black, white, 'f2', 'f3')
  await play(white, black, black, 'e7', 'e5')
  await play(white, black, white, 'g2', 'g4')
  const last = await play(white, black, black, 'd8', 'h4')
  expect(last.isGameOver).toBe(true)
  const a = await white.next('game_over')
  expect(a).toEqual(await black.next('game_over'))
  expect(a.result).toBe('black')
  expect(a.reason).toBe('checkmate')
  expect(a.fen).toBe(last.fen)
  expect(readGameSnapshot(a).moveHistory.length).toBe(4)
  expect(a.ply).toBe(4)
  white.send({ type: 'move', from: 'a2', to: 'a3' })
  expect((await white.next('game_unavailable')).gameId).toBe(last.gameId)
})

test('draw acceptance requires an opponent offer; declines and moves clear offers', async () => {
  start()
  const { white, black } = await match()
  white.send({ type: 'draw_accept' })
  expect((await white.next('error')).message).toContain('no opponent draw offer')
  white.send({ type: 'draw_offer' })
  const offered = await white.next('game_state')
  expect(offered).toEqual(await black.next('game_state'))
  expect(offered.drawOfferedBy).toBeTruthy()
  white.send({ type: 'draw_accept' })
  expect((await white.next('error')).message).toContain('no opponent draw offer')
  black.send({ type: 'draw_decline' })
  expect((await white.next('game_state')).drawOfferedBy).toBeNull()
  await black.next('game_state')
  black.send({ type: 'draw_offer' })
  await white.next('game_state'); await black.next('game_state')
  expect((await play(white, black, white, 'e2', 'e4')).drawOfferedBy).toBeNull()
  white.send({ type: 'draw_offer' })
  await white.next('game_state'); await black.next('game_state')
  black.send({ type: 'draw_accept' })
  const result = await white.next('game_over')
  expect(result.result).toBe('draw')
  expect(result.reason).toBe('agreement')
  expect(result.isGameOver).toBe(true)
  expect(result.drawOfferedBy).toBeNull()
  expect(result.ply).toBe(1)
})

test('threefold repetition retains the full move history and ends in a draw', async () => {
  start()
  const { white, black } = await match()
  for (let cycle = 0; cycle < 2; cycle++) {
    await play(white, black, white, 'g1', 'f3')
    await play(white, black, black, 'g8', 'f6')
    await play(white, black, white, 'f3', 'g1')
    await play(white, black, black, 'f6', 'g8')
  }
  const ended = await white.next('game_over')
  expect(ended.result).toBe('draw')
  expect(ended.ply).toBe(8)
  expect(ended.pgn).toContain('4. Ng1 Ng8')
})

test('server clock switches only after accepted moves; invalid and duplicate requests keep it running', async () => {
  let time = 0
  start({ initialTimeMs: 1000, now: () => time })
  const { white, black, info } = await match()
  expect(info.clock).toMatchObject({ whiteMs: 1000, blackMs: 1000, running: 'w', incrementMs: 0 })
  time = 200
  white.send({ type: 'move', from: 'e2', to: 'e5', whiteMs: 999999 })
  const rejected = await white.next('move_rejected')
  expect(rejected.clock).toMatchObject({ whiteMs: 800, blackMs: 1000, running: 'w' })
  time = 400
  const requestId = crypto.randomUUID()
  white.send({ type: 'move', from: 'e2', to: 'e4', requestId, clock: { whiteMs: 999999 } })
  const accepted = await white.next('move'); await black.next('move')
  expect(accepted.clock).toMatchObject({ whiteMs: 600, blackMs: 1000, running: 'b' })
  time = 500
  white.send({ type: 'move', from: 'e2', to: 'e4', requestId })
  expect((await white.next('move_rejected')).clock).toMatchObject({ whiteMs: 600, blackMs: 900, running: 'b' })
  time = 600
  const next = await play(white, black, black, 'e7', 'e5')
  expect(next.clock).toMatchObject({ whiteMs: 600, blackMs: 800, running: 'w' })
})

test('deadline timer ends an idle game without receiving any move', async () => {
  start({ initialTimeMs: 120 })
  const { white, black } = await match()
  const ended = await white.next('game_over')
  expect(ended).toEqual(await black.next('game_over'))
  expect(ended.result).toBe('black')
  expect(ended.reason).toBe('timeout')
  expect(ended.ply).toBe(0)
  expect(ended.clock).toMatchObject({ whiteMs: 0, blackMs: 120, running: null })
  white.send({ type: 'move', from: 'e2', to: 'e4' })
  await white.next('game_unavailable')
  expect(white.messages.some(message => message.type === 'game_over')).toBe(false)
})

test.each(['move', 'resign', 'draw_accept', 'sync_game'])('expiry wins over a late %s even when the timer callback is delayed', async type => {
  let time = 0
  start({ initialTimeMs: 1000, now: () => time })
  const { white, black } = await match()
  time = 1000
  white.send({ type, from: 'e2', to: 'e4' })
  const ended = await white.next('game_over')
  await black.next('game_over')
  expect(ended.reason).toBe('timeout')
  expect(ended.result).toBe('black')
  expect(ended.ply).toBe(0)
  expect(ended.clock.whiteMs).toBe(0)
})

test('clock heartbeat is identical for both players and stops after resignation', async () => {
  start({ initialTimeMs: 5000 })
  const { white, black, info } = await match()
  const tick = await white.next('clock')
  expect(tick).toEqual(await black.next('clock'))
  expect(tick.ply).toBe(0)
  expect(tick.clock.whiteMs).toBeLessThan(info.clock.whiteMs)
  expect(tick.clock.blackMs).toBe(5000)
  expect(tick.clock.revision).toBeGreaterThan(info.clock.revision)
  white.send({ type: 'resign' })
  const ended = await white.next('game_over')
  await black.next('game_over')
  expect(ended.clock.running).toBeNull()
  expect(ended.clock.whiteMs).toBeGreaterThan(0)
  await Bun.sleep(1100)
  expect(white.messages.some(message => ['clock', 'game_over'].includes(message.type))).toBe(false)
})

test('an accepted white move transfers the deadline and idle black loses on time', async () => {
  start({ initialTimeMs: 150 })
  const { white, black } = await match()
  await play(white, black, white, 'e2', 'e4')
  const ended = await white.next('game_over')
  expect(ended).toEqual(await black.next('game_over'))
  expect(ended.result).toBe('white')
  expect(ended.reason).toBe('timeout')
  expect(ended.ply).toBe(1)
  expect(ended.clock.blackMs).toBe(0)
  expect(ended.clock.whiteMs).toBeGreaterThan(0)
})

test('a disconnect after flag fall cannot replace timeout with abandonment', async () => {
  let time = 0
  start({ initialTimeMs: 1000, now: () => time })
  const { white, black } = await match()
  time = 1000
  await white.close()
  const ended = await black.next('game_over')
  expect(ended.reason).toBe('timeout')
  expect(ended.result).toBe('black')
  expect(ended.clock.running).toBeNull()
})

test('reconnect restores the same game, history, color and clocks after opponent moved while away', async () => {
  let time = 0
  start({ initialTimeMs: 10000, reconnectGraceMs: 1000, now: () => time })
  const { white, black, info } = await match()
  const first = await play(white, black, white, 'e2', 'e4')
  await white.close()
  const absent = await black.next('game_state')
  expect(absent.presence).toEqual({ w: false, b: true })
  time = 300
  black.send({ type: 'move', from: 'e7', to: 'e5' })
  const duringAbsence = await black.next('move')
  time = 450
  const replacement = await connect()
  await replacement.authenticate(players.get(info.white.id)!)
  const resumed = await replacement.next('game_resumed')
  expect(resumed.gameId).toBe(info.gameId)
  expect(resumed.color).toBe('w')
  expect(resumed.ply).toBe(2)
  expect(resumed.fen).toBe(duringAbsence.fen)
  expect(readGameSnapshot(resumed).moveHistory.map(move => move.san)).toEqual(['e4', 'e5'])
  expect(resumed.clock).toMatchObject({ whiteMs: 9850, blackMs: 9700, running: 'w' })
  expect(resumed.presence).toEqual({ w: true, b: true })
  expect((await black.next('game_state')).presence.w).toBe(true)
  replacement.send({ type: 'move', from: 'g1', to: 'f3', requestId: first.requestId })
  expect((await replacement.next('move_rejected')).code).toBe('duplicate_request')
  expect((await play(replacement, black, replacement, 'g1', 'f3')).ply).toBe(3)
})

test('reconnect cancels the old grace deadline instead of forfeiting a restored game', async () => {
  start({ initialTimeMs: 5000, reconnectGraceMs: 80 })
  const { white, black, info } = await match()
  await white.close()
  await black.next('game_state')
  const replacement = await connect()
  await replacement.authenticate(players.get(info.white.id)!)
  await replacement.next('game_resumed')
  await Bun.sleep(120)
  expect(replacement.messages.some(message => message.type === 'game_over')).toBe(false)
  replacement.messages.length = 0
  replacement.send({ type: 'sync_game' })
  expect((await replacement.next('game_state')).gameId).toBe(info.gameId)
})

test('grace expiry forfeits the absent player and returns their final result on reconnect', async () => {
  start({ initialTimeMs: 5000, reconnectGraceMs: 50 })
  const { white, black, info } = await match()
  await white.close()
  await black.next('game_state')
  const ended = await black.next('game_over')
  expect(ended.result).toBe('black')
  expect(ended.reason).toBe('abandonment')
  const late = await connect()
  await late.authenticate(players.get(info.white.id)!)
  const recovered = await late.next('game_resumed')
  expect(recovered.isGameOver).toBe(true)
  expect(recovered.result).toBe('black')
  expect(recovered.gameId).toBe(info.gameId)
  expect(recovered.clock.running).toBeNull()
  late.send({ type: 'ack_result', gameId: info.gameId })
  await late.close()
  const again = await connect()
  await again.authenticate(players.get(info.white.id)!)
  await again.next('session_idle')
})

test('returning exactly at the grace deadline cannot avoid forfeiting a game', async () => {
  let time = 0
  start({ initialTimeMs: 10000, reconnectGraceMs: 1000, now: () => time })
  const { white, black, info } = await match()
  await white.close()
  await black.next('game_state')
  time = 1000
  const late = await connect()
  await late.authenticate(players.get(info.white.id)!)
  const result = await late.next('game_resumed')
  expect(result.isGameOver).toBe(true)
  expect(result.reason).toBe('abandonment')
  expect(result.result).toBe('black')
})

test('clock keeps running during the reconnect window and can end the game first', async () => {
  start({ initialTimeMs: 150, reconnectGraceMs: 1000 })
  const { white, black, info } = await match()
  await white.close()
  await black.next('game_state')
  const result = await black.next('game_over')
  expect(result.reason).toBe('timeout')
  expect(result.clock.whiteMs).toBe(0)
  const late = await connect()
  await late.authenticate(players.get(info.white.id)!)
  expect((await late.next('game_resumed')).reason).toBe('timeout')
})

test('both disconnected players receive a draw if neither returns before the grace deadline', async () => {
  start({ initialTimeMs: 5000, reconnectGraceMs: 50 })
  const { white, black, info } = await match()
  await white.close()
  await black.close()
  await Bun.sleep(80)
  const returned = await connect()
  await returned.authenticate(players.get(info.black.id)!)
  const result = await returned.next('game_resumed')
  expect(result.isGameOver).toBe(true)
  expect(result.result).toBe('draw')
  expect(result.reason).toBe('both_disconnected')
})

test('a different account cannot request or recover another player\'s match', async () => {
  start()
  const { white, black, info } = await match()
  await white.close()
  await black.next('game_state')
  const outsider = await connect()
  const token = await authJwt.decorator.jwt.sign({ sub: carol.id })
  outsider.send({ type: 'authenticate', token, userId: info.white.id, gameId: info.gameId })
  await outsider.next('authenticated')
  await outsider.next('session_idle')
  outsider.send({ type: 'sync_game', gameId: info.gameId })
  await outsider.next('game_unavailable')
  expect(outsider.messages.some(message => message.type === 'game_resumed')).toBe(false)
})

test('in-memory final receipts expire after five minutes', async () => {
  let time = 0
  start({ initialTimeMs: 10000, now: () => time })
  const { white, black, info } = await match()
  white.send({ type: 'resign' })
  await white.next('game_over'); await black.next('game_over')
  await white.close()
  time = 300001
  const returned = await connect()
  await returned.authenticate(players.get(info.white.id)!)
  await returned.next('session_idle')
})

test('all duplicate end commands produce one immutable, complete result record', async () => {
  const records: import('../db/gameRepository').CompletedGame[] = []
  start({ resultSink: { start() {}, enqueue: row => { records.push(row) }, async stop() {} } })
  const { white, black, info } = await match()
  await play(white, black, white, 'e2', 'e4')
  white.send({ type: 'resign' })
  white.send({ type: 'resign' })
  const ended = await white.next('game_over')
  await black.next('game_over')
  expect(records.length).toBe(1)
  const row = records[0]!
  expect(row.id).toBe(info.gameId)
  expect(row.whiteId).toBe(info.white.id)
  expect(row.blackId).toBe(info.black.id)
  expect(row.result).toBe('black')
  expect(row.pgn).toBe(ended.pgn)
  expect(row.pgn).toContain('[Result "0-1"]')
  expect(row.pgn).toContain('[EndReason "resignation"]')
  expect(row.pgn).toContain('[TimeControl "300+0"]')
  expect(new Date(row.endedAt).getTime()).toBeGreaterThanOrEqual(new Date(row.startedAt).getTime())
  expect(ended.persistence).toBe('queued')
})

test('a journal failure freezes the game and retries before reporting game over', async () => {
  let attempts = 0
  const records: import('../db/gameRepository').CompletedGame[] = []
  start({ resultSink: { start() {}, enqueue: row => {
    attempts++
    if (attempts === 1) throw new Error('disk temporarily unavailable')
    records.push(row)
  }, async stop() {} } })
  const { white, black } = await match()
  white.send({ type: 'resign' })
  const waiting = await white.next('game_finalizing')
  await black.next('game_finalizing')
  expect(waiting.isGameOver).toBe(true)
  expect(waiting.clock.running).toBeNull()
  expect(white.messages.some(message => message.type === 'game_over')).toBe(false)
  white.send({ type: 'move', from: 'e2', to: 'e4' })
  expect((await white.next('game_finalizing')).ply).toBe(0)
  const ended = await white.next('game_over')
  await black.next('game_over')
  expect(ended.result).toBe('black')
  expect(records.length).toBe(1)
  expect(attempts).toBe(2)
})

test('player names cannot inject result tags into the persisted PGN', async () => {
  start({ findPlayer: async id => {
    const player = players.get(id)
    return player ? { ...player, username: id === alice.id ? 'Captain "\n[Result "1-0"]' : player.username } : null
  } })
  const a = await connect(), b = await connect()
  await a.authenticate(alice); await b.authenticate(bob)
  a.send({ type: 'join_queue' }); await a.next('queue_joined')
  b.send({ type: 'join_queue' })
  const info = await a.next('game_start'); await b.next('game_start')
  a.send({ type: 'resign' })
  const ended = await a.next('game_over')
  expect(() => readGameSnapshot(ended)).not.toThrow()
  expect(ended.result).toBe(info.color === 'w' ? 'black' : 'white')
  expect(ended.pgn).toContain('[EndReason "resignation"]')
})


test('assigned war players wait for each other, keep fixed colors and journal the linked result once', async () => {
  const id = crypto.randomUUID(), records: any[] = []
  start({ getWarMatch: async (actorId, matchId) => {
    if (matchId !== id || ![alice.id, bob.id].some(value => value === actorId)) throw new Error('Not assigned')
    return { id, whiteId: bob.id, blackId: alice.id }
  }, resultSink: { start() {}, enqueue(record) { records.push(record) }, async stop() {} } })
  const a = await connect(), b = await connect(), c = await connect()
  await a.authenticate(alice); await b.authenticate(bob); await c.authenticate(carol)
  c.send({ type: 'join_war_match', matchId: id, userId: bob.id })
  expect((await c.next('war_error')).message).toContain('unavailable')
  a.send({ type: 'join_war_match', matchId: id }); await a.next('war_waiting')
  expect(a.messages.some(message => message.type === 'game_start')).toBe(false)
  b.send({ type: 'join_war_match', matchId: id })
  const info = await b.next('game_start'); await a.next('game_start')
  expect(info.color).toBe('w'); expect(info.gameId).toBe(id); expect(info.warMatchId).toBe(id)
  expect(info.white.id).toBe(bob.id); expect(info.black.id).toBe(alice.id)
  b.send({ type: 'resign', gameId: id })
  await a.next('game_over'); await b.next('game_over')
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ id, warMatchId: id, whiteId: bob.id, blackId: alice.id, result: 'black' })
  a.send({ type: 'join_war_match', matchId: id })
  expect((await a.next('war_error')).message).toContain('finished')
})

test('war waiting can be cancelled and cannot enter the random queue simultaneously', async () => {
  const id = crypto.randomUUID()
  start({ getWarMatch: async () => ({ id, whiteId: alice.id, blackId: bob.id }) })
  const a = await connect(); await a.authenticate(alice)
  a.send({ type: 'join_war_match', matchId: id }); await a.next('war_waiting')
  a.send({ type: 'join_queue' }); expect((await a.next('error')).message).toContain('waiting room')
  a.send({ type: 'leave_war_match' }); await a.next('war_left')
  a.send({ type: 'join_queue' }); await a.next('queue_joined')
})

test('leadership entry authenticates assignment, preserves its tag through reconnect and journals once', async () => {
  const id = crypto.randomUUID(), records: any[] = [], snapshots: any[] = []
  start({ getLeadershipMatch: async (actor, matchId) => {
    if (matchId !== id || ![alice.id, bob.id].some(value => value === actor)) throw new Error('Not assigned')
    return { id, whiteId: alice.id, blackId: bob.id }
  }, activeStore: { load: () => [], save(row) { snapshots.push(structuredClone(row)) }, remove() {} },
    resultSink: { start() {}, enqueue(row) { records.push(row) }, async stop() {} } })
  const a = await connect(), b = await connect(), stranger = await connect()
  await a.authenticate(alice); await b.authenticate(bob); await stranger.authenticate(carol)
  stranger.send({ type: 'join_leadership_match', matchId: id, userId: alice.id })
  expect((await stranger.next('war_error')).type).toBe('war_error')
  a.send({ type: 'join_leadership_match', matchId: id })
  expect((await a.next('war_waiting')).kind).toBe('leadership')
  b.send({ type: 'join_leadership_match', matchId: id })
  const info = await a.next('game_start'); await b.next('game_start')
  expect(info).toMatchObject({ gameId: id, color: 'w', leadershipMatchId: id })
  expect(info.warMatchId).toBeUndefined()
  a.send({ type: 'move', from: 'e2', to: 'e4' }); await a.next('move'); await b.next('move')
  await a.close()
  const returned = await connect(); await returned.authenticate(alice)
  expect(await returned.next('game_resumed')).toMatchObject({ leadershipMatchId: id, ply: 1, color: 'w' })
  b.send({ type: 'resign' })
  await returned.next('game_over'); await b.next('game_over')
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ id, leadershipMatchId: id, whiteId: alice.id, blackId: bob.id, result: 'white' })
  expect(records[0].warMatchId).toBeUndefined()
  expect(snapshots.length).toBeGreaterThan(1)
  expect(snapshots.every(row => row.leadershipMatchId === id && !row.warMatchId)).toBe(true)
  returned.send({ type: 'join_leadership_match', matchId: id })
  expect((await returned.next('war_error')).message).toContain('finished')
})

test('cancelling or disconnecting during a war lookup cannot create a waiting-room ghost', async () => {
  const id = crypto.randomUUID()
  let resolveLookup!: (value: { id: string; whiteId: string; blackId: string }) => void
  start({ getWarMatch: () => new Promise(resolve => { resolveLookup = resolve }) })
  const a = await connect(); await a.authenticate(alice)
  a.send({ type: 'join_war_match', matchId: id })
  a.send({ type: 'leave_war_match' }); await a.next('war_left')
  resolveLookup({ id, whiteId: alice.id, blackId: bob.id })
  a.send({ type: 'join_queue' }); await a.next('queue_joined')
  expect(a.messages.some(message => message.type === 'war_waiting')).toBe(false)
})


test('a disconnected war fighter resumes the assigned board with its position and color', async () => {
  const id = crypto.randomUUID()
  start({ getWarMatch: async () => ({ id, whiteId: alice.id, blackId: bob.id }) })
  const a = await connect(), b = await connect()
  await a.authenticate(alice); await b.authenticate(bob)
  a.send({ type: 'join_war_match', matchId: id }); await a.next('war_waiting')
  b.send({ type: 'join_war_match', matchId: id }); await a.next('game_start'); await b.next('game_start')
  a.send({ type: 'move', gameId: id, ply: 0, requestId: crypto.randomUUID(), from: 'e2', to: 'e4' })
  await a.next('move'); await b.next('move')
  await b.close()
  const restored = await connect(); await restored.authenticate(bob)
  const resume = await restored.next('game_resumed')
  expect(resume.gameId).toBe(id); expect(resume.warMatchId).toBe(id); expect(resume.color).toBe('b'); expect(resume.ply).toBe(1)
  restored.send({ type: 'resign', gameId: id }); await restored.next('game_over'); await a.next('game_over')
})


test('war waiting attendance is cleared on cancel and expired entry cannot create a game', async () => {
  const id = crypto.randomUUID(), readyAt = new Date().toISOString(), cleared: string[] = []
  let expired = false
  start({ getWarMatch: async () => ({ id, whiteId: alice.id, blackId: bob.id, readyAt,
    joinDeadline: new Date(Date.now() + (expired ? -1000 : 100000)).toISOString() }),
    clearWarReady: async (actorId, matchId, stamp) => { cleared.push(`${actorId}:${matchId}:${stamp}`) } })
  const a = await connect(); await a.authenticate(alice)
  a.send({ type: 'join_war_match', matchId: id }); await a.next('war_waiting')
  expect(app!.decorator.isWarMatchProtected(id)).toBe(false)
  a.send({ type: 'leave_war_match' }); await a.next('war_left')
  expect(cleared).toHaveLength(1)
  expired = true
  a.send({ type: 'join_war_match', matchId: id })
  expect((await a.next('war_error')).message).toContain('deadline')
  expect(a.messages.some(message => message.type === 'game_start')).toBe(false)
})


test('storage failures reject uncommitted moves and freeze terminal results until they are journaled', async () => {
  let fail = false, terminalFail = false
  const stored = new Map<string, any>(), records: any[] = []
  start({ activeStore: { load: () => [], save(record) {
    if (fail || (terminalFail && record.finalization)) throw new Error('disk full')
    stored.set(record.id, JSON.parse(JSON.stringify(record)))
  }, remove(id) { stored.delete(id) } }, resultSink: { start() {}, enqueue(record) {
    expect(stored.get(record.id)?.finalization?.record).toEqual(record); records.push(record)
  }, async stop() {} } })
  const { white, black, info } = await match(), requestId = crypto.randomUUID()
  fail = true
  white.send({ type: 'move', gameId: info.gameId, ply: 0, requestId, from: 'e2', to: 'e4' })
  const rejected = await white.next('move_rejected')
  expect(rejected).toMatchObject({ code: 'storage_unavailable', ply: 0, fen: info.fen })
  expect(stored.get(info.gameId).fen).toBe(info.fen)
  fail = false
  white.send({ type: 'move', gameId: info.gameId, ply: 0, requestId, from: 'e2', to: 'e4' })
  await white.next('move'); await black.next('move')
  terminalFail = true
  black.send({ type: 'resign', gameId: info.gameId }); await black.next('game_finalizing')
  expect(records).toHaveLength(0)
  terminalFail = false
  await white.next('game_over'); await black.next('game_over')
  expect(records).toHaveLength(1); expect(stored.has(info.gameId)).toBe(false)
})


test('async commits serialize one board without blocking moves on another board', async () => {
  const dan = { id: crypto.randomUUID(), username: 'Dan', rating: 1200 }
  const accounts = new Map<string, AuthenticatedPlayer>([alice, bob, carol, dan].map(player => [player.id, player]))
  let blockedId = '', blockOnce = true, entered!: () => void, release!: () => void
  const enteredWrite = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  start({ findPlayer: async id => accounts.get(id) ?? null, activeStore: { load: () => [], async save(record) {
    if (record.id === blockedId && blockOnce) { blockOnce = false; entered(); await gate }
  }, remove() {} } })
  const first = await match(), c = await connect(), d = await connect()
  await c.authenticate(carol); await d.authenticate(dan)
  c.send({ type: 'join_queue' }); await c.next('queue_joined'); d.send({ type: 'join_queue' })
  const second = await c.next('game_start'); await d.next('game_start')
  const secondWhite = second.color === 'w' ? c : d
  blockedId = first.info.gameId
  first.white.send({ type: 'move', gameId: blockedId, ply: 0, requestId: 'blocked-white', from: 'e2', to: 'e4' })
  await enteredWrite
  try {
    first.black.send({ type: 'move', gameId: blockedId, ply: 1, requestId: 'queued-black', from: 'e7', to: 'e5' })
    secondWhite.send({ type: 'move', gameId: second.gameId, ply: 0, requestId: 'other-board', from: 'e2', to: 'e4' })
    expect((await secondWhite.next('move')).ply).toBe(1)
    expect(first.white.messages.some(message => message.type === 'move')).toBe(false)
  } finally { release() }
  expect((await first.white.next('move')).ply).toBe(1)
  expect((await first.white.next('move')).ply).toBe(2)
})
