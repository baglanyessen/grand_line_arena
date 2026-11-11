import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { authJwt } from '../auth/jwt'
import { Chess } from 'chess.js'
import { FileActiveGameStore, type StoredGame } from './activeGameStore'

const alice = { id: crypto.randomUUID(), username: 'Alice', rating: 1200 }, bob = { id: crypto.randomUUID(), username: 'Bob', rating: 1200 }
const children: ReturnType<typeof Bun.spawn>[] = [], sockets: WebSocket[] = [], directories: string[] = []
function directory() { const path = mkdtempSync(join(tmpdir(), 'chess-active-test-')); directories.push(path); return path }
async function until(condition: () => boolean, timeout = 5000) {
  const start = Date.now()
  while (!condition()) { if (Date.now() - start > timeout) throw new Error('Recovery test timed out'); await Bun.sleep(10) }
}
async function boot(root: string, clock = 60000, warId?: string, kind: 'war' | 'leadership' = 'war') {
  const ready = join(root, `ready-${crypto.randomUUID()}.json`)
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL('./fixtures/activeRecovery.worker.ts', import.meta.url))],
    { env: { ...process.env, RECOVERY_TEST_DIR: root, RECOVERY_TEST_PLAYERS: JSON.stringify([alice, bob]), RECOVERY_TEST_READY: ready, RECOVERY_TEST_CLOCK: String(clock), ...(warId ? { [kind === 'war' ? 'RECOVERY_TEST_WAR' : 'RECOVERY_TEST_LEADERSHIP']: warId } : {}) },
      stdout: 'ignore', stderr: 'pipe' })
  children.push(child)
  await until(() => existsSync(ready) || child.exitCode !== null)
  if (!existsSync(ready)) throw new Error(await new Response(child.stderr).text())
  return { child, port: JSON.parse(readFileSync(ready, 'utf8')).port as number }
}
async function peer(port: number, player: typeof alice) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/chess`), messages: any[] = []
  sockets.push(ws)
  ws.addEventListener('message', event => messages.push(JSON.parse(String(event.data))))
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('Connection failed')) })
  const next = async (type: string) => { await until(() => messages.some(message => message.type === type)); return messages.splice(messages.findIndex(message => message.type === type), 1)[0] }
  const send = (data: unknown) => ws.send(JSON.stringify(data))
  send({ type: 'authenticate', token: await authJwt.decorator.jwt.sign({ sub: player.id }) }); await next('authenticated')
  return { ws, next, send, player }
}
async function match(port: number, warId?: string, kind: 'war' | 'leadership' = 'war') {
  const a = await peer(port, alice), b = await peer(port, bob)
  if (warId) { const type = kind === 'war' ? 'join_war_match' : 'join_leadership_match'; a.send({ type, matchId: warId }); await a.next('war_waiting'); b.send({ type, matchId: warId }) }
  else { a.send({ type: 'join_queue' }); await a.next('queue_joined'); b.send({ type: 'join_queue' }) }
  const info = await a.next('game_start'); await b.next('game_start')
  return { info, white: info.color === 'w' ? a : b, black: info.color === 'w' ? b : a }
}
async function crash(child: ReturnType<typeof Bun.spawn>) { child.kill(9); await child.exited }
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close()
  for (const child of children.splice(0)) { if (child.exitCode === null) child.kill(9); await child.exited }
  for (const root of directories.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('chess-active-test-')) throw new Error('Unsafe recovery test cleanup')
    rmSync(root, { recursive: true, force: true })
  }
})

for (const kind of ['war', 'leadership'] as const) test(`${kind}: fresh server processes recover acknowledged history, colors, clocks, draw offer and duplicate request protection`, async () => {
  const root = directory(), warId = crypto.randomUUID(), first = await boot(root, 60000, warId, kind), game = await match(first.port, warId, kind), requests: string[] = []
  let state = game.info
  for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6']]) {
    const requestId = crypto.randomUUID(); requests.push(requestId)
    ;(state.turn === 'w' ? game.white : game.black).send({ type: 'move', gameId: state.gameId, ply: state.ply, requestId, from, to })
    state = await game.white.next('move'); await game.black.next('move')
  }
  game.white.send({ type: 'draw_offer', gameId: state.gameId }); await game.white.next('game_state'); await game.black.next('game_state')
  const activePath = join(root, 'active', `${state.gameId}.json`), saved = JSON.parse(readFileSync(activePath, 'utf8')) as StoredGame
  await crash(first.child); await Bun.sleep(120)
  const second = await boot(root), white = await peer(second.port, game.white.player), black = await peer(second.port, game.black.player)
  const resumed = await white.next('game_resumed'), other = await black.next('game_resumed')
  expect(resumed).toMatchObject({ gameId: state.gameId, fen: state.fen, pgn: state.pgn, ply: 4, color: 'w', drawOfferedBy: game.white.player.id })
  expect(other.color).toBe('b'); expect(resumed[kind === 'war' ? 'warMatchId' : 'leadershipMatchId']).toBe(warId)
  expect(resumed.clock.whiteMs).toBeLessThan(saved.clock.whiteMs - 100)
  expect(resumed.clock.blackMs).toBe(saved.clock.blackMs)
  white.send({ type: 'move', gameId: state.gameId, ply: 4, requestId: requests[0], from: 'e2', to: 'e4' })
  expect((await white.next('move_rejected')).code).toBe('duplicate_request')
  black.send({ type: 'draw_accept', gameId: state.gameId }); await white.next('game_over'); await black.next('game_over')
  const completedPath = join(root, 'completed', `${state.gameId}.json`)
  await until(() => existsSync(completedPath))
  expect(JSON.parse(readFileSync(completedPath, 'utf8'))).toMatchObject({ result: 'draw', [kind === 'war' ? 'warMatchId' : 'leadershipMatchId']: warId })
  expect(existsSync(activePath)).toBe(false)
  await crash(second.child)
  const third = await boot(root), idle = await peer(third.port, alice)
  await idle.next('session_idle')
  expect(readdirSync(join(root, 'completed'))).toHaveLength(1)
}, 15000)

test('downtime is charged to the running clock and an expired recovered game finishes exactly once', async () => {
  const root = directory(), first = await boot(root, 1000), game = await match(first.port)
  game.white.send({ type: 'move', gameId: game.info.gameId, ply: 0, requestId: crypto.randomUUID(), from: 'e2', to: 'e4' })
  await game.white.next('move'); await game.black.next('move')
  await crash(first.child); await Bun.sleep(1200)
  const second = await boot(root, 1000), completed = join(root, 'completed', `${game.info.gameId}.json`)
  await until(() => existsSync(completed))
  const record = JSON.parse(readFileSync(completed, 'utf8'))
  expect(record.result).toBe('white'); expect(record.pgn).toContain('[EndReason "timeout"]')
  expect(readdirSync(join(root, 'active'))).toHaveLength(0)
  await crash(second.child); await boot(root, 1000)
  expect(readdirSync(join(root, 'completed'))).toHaveLength(1)
}, 15000)

test('corrupt active snapshots stop startup and remain available for repair', () => {
  const root = directory(), store = new FileActiveGameStore(root), file = join(root, `${crypto.randomUUID()}.json`)
  writeFileSync(file, '{broken')
  expect(() => store.load()).toThrow()
  expect(existsSync(file)).toBe(true)
  expect(() => store.remove('../outside')).toThrow('Invalid active game ID')
})

test('repeated crashes preserve an existing reconnect deadline instead of renewing it', async () => {
  const root = directory(), first = await boot(root), game = await match(first.port)
  const path = join(root, 'active', `${game.info.gameId}.json`)
  game.black.ws.close(); await game.white.next('game_state')
  const saved = JSON.parse(readFileSync(path, 'utf8')) as StoredGame
  expect(saved.black.connected).toBe(false)
  await crash(first.child)
  const second = await boot(root), rebased = JSON.parse(readFileSync(path, 'utf8')) as StoredGame
  expect(Math.abs(rebased.black.reconnectUntil! - saved.black.reconnectUntil!)).toBeLessThan(3)
  await crash(second.child)
  await boot(root)
  const again = JSON.parse(readFileSync(path, 'utf8')) as StoredGame
  expect(Math.abs(again.black.reconnectUntil! - saved.black.reconnectUntil!)).toBeLessThan(4)
  expect(Math.abs(again.white.reconnectUntil! - rebased.white.reconnectUntil!)).toBeLessThan(3)
}, 15000)

test('a stale terminal snapshot replays the identical final record without resurrecting a live game', async () => {
  const root = directory(), first = await boot(root), game = await match(first.port)
  const path = join(root, 'active', `${game.info.gameId}.json`), saved = JSON.parse(readFileSync(path, 'utf8')) as StoredGame
  game.white.send({ type: 'resign', gameId: game.info.gameId }); await game.white.next('game_over'); await game.black.next('game_over')
  const completed = join(root, 'completed', `${game.info.gameId}.json`)
  await until(() => existsSync(completed)); await crash(first.child)
  const record = JSON.parse(readFileSync(completed, 'utf8')), chess = new Chess(); chess.loadPgn(record.pgn)
  const headers = chess.getHeaders()
  new FileActiveGameStore(join(root, 'active')).save({ ...saved, pgn: record.pgn, fen: chess.fen(), drawOfferedBy: null, savedAt: Date.now(),
    clock: { ...saved.clock, running: null, whiteMs: Number(headers.WhiteClockMs), blackMs: Number(headers.BlackClockMs) },
    finalization: { record, reason: 'resignation' } })
  const second = await boot(root), returned = await peer(second.port, game.white.player)
  const receipt = await returned.next('game_resumed')
  expect(receipt).toMatchObject({ gameId: game.info.gameId, result: record.result, isGameOver: true, reason: 'resignation' })
  expect(existsSync(path)).toBe(false)
  expect(readdirSync(join(root, 'completed'))).toHaveLength(1)
  expect(JSON.parse(readFileSync(completed, 'utf8'))).toEqual(record)
}, 15000)
