import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import postgres from 'postgres'
import { Chess } from 'chess.js'
import { migrateActiveGames } from './migrateActiveGames'
import { PostgresActiveGameStore } from './postgresActiveGameStore'
import { FileActiveGameStore, type StoredGame } from '../ws/activeGameStore'
import { authJwt } from '../auth/jwt'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const enabled = process.env.RUN_POSTGRES_TESTS === '1', pgTest = enabled ? test : test.skip
const namespace = `active_test_${crypto.randomUUID().replaceAll('-', '')}`
const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/grand_line_arena'
let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>, created = false
const stores: PostgresActiveGameStore[] = []
const children: ReturnType<typeof Bun.spawn>[] = [], temporary: string[] = [], sockets: WebSocket[] = []
function store(sql = client) { const value = new PostgresActiveGameStore(sql, 5); stores.push(value); return value }
async function snapshot(): Promise<StoredGame> {
  const white = crypto.randomUUID(), black = crypto.randomUUID(), at = Date.now(), chess = new Chess()
  await client`INSERT INTO users (id) VALUES (${white}), (${black})`
  return { version: 1, id: crypto.randomUUID(), pgn: chess.pgn(), fen: chess.fen(), startedAt: at, savedAt: at,
    white: { id: white, username: 'White', rating: 1200, connected: true, reconnectUntil: null },
    black: { id: black, username: 'Black', rating: 1200, connected: true, reconnectUntil: null },
    drawOfferedBy: null, acceptedRequests: [], clock: { whiteMs: 60000, blackMs: 60000, initialMs: 60000, running: 'w', revision: 0 } }
}
beforeAll(async () => {
  if (!enabled) return
  admin = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} })
  await admin.unsafe(`CREATE SCHEMA "${namespace}"`); created = true
  client = postgres(url, { max: 5, connect_timeout: 5, onnotice: () => {}, connection: { search_path: namespace, statement_timeout: 5000 } })
  await client.unsafe("CREATE TABLE users (id uuid PRIMARY KEY, username text NOT NULL DEFAULT 'Player', bounty bigint NOT NULL DEFAULT 0, bounty_version integer NOT NULL DEFAULT 0)")
  await client.unsafe("CREATE TYPE game_result AS ENUM ('white','black','draw','ongoing')")
  await client.unsafe(`CREATE TABLE games (id uuid PRIMARY KEY, white_id uuid NOT NULL REFERENCES users(id), black_id uuid NOT NULL REFERENCES users(id),
    pgn text NOT NULL DEFAULT '', result game_result NOT NULL DEFAULT 'ongoing', rating_change_white integer, rating_change_black integer,
    started_at timestamp NOT NULL DEFAULT now(), ended_at timestamp)`)
  await client.unsafe(`CREATE TABLE game_rewards (game_id uuid PRIMARY KEY REFERENCES games(id), white_delta integer NOT NULL, black_delta integer NOT NULL,
    white_after bigint NOT NULL, black_after bigint NOT NULL, status text NOT NULL, policy_version integer NOT NULL, settled_at timestamp NOT NULL DEFAULT now())`)
  await migrateActiveGames(client); await migrateActiveGames(client)
})
afterEach(async () => {
  if (!enabled) return
  for (const ws of sockets.splice(0)) ws.close()
  for (const child of children.splice(0)) { if (child.exitCode === null) child.kill(9); await child.exited }
  for (const current of stores.splice(0)) await current.close()
  await client`DELETE FROM active_games`
  for (const directory of temporary.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('chess-pg-recovery-')) throw new Error('Unsafe test cleanup')
    rmSync(directory, { recursive: true, force: true })
  }
})
afterAll(async () => {
  if (!enabled) return
  await client?.end()
  if (created) { if (!/^active_test_[a-f0-9]{32}$/.test(namespace)) throw new Error('Unsafe test schema'); await admin.unsafe(`DROP SCHEMA "${namespace}" CASCADE`) }
  await admin?.end()
})

pgTest('PostgreSQL snapshots survive fresh store instances and reserve each participant once', async () => {
  const first = store(), game = await snapshot(); expect(await first.load()).toEqual([])
  await first.save(game)
  const other = crypto.randomUUID(); await client`INSERT INTO users (id) VALUES (${other})`
  await expect(first.save({ ...game, white: { ...game.white, id: other } })).rejects.toThrow('participants or assignment changed')
  await expect(first.save({ ...game, id: crypto.randomUUID() })).rejects.toThrow()
  expect(await client`SELECT id FROM active_games`).toHaveLength(1)
  await first.close()
  const second = store(); expect(await second.load()).toEqual([game])
  await second.save({ ...game, drawOfferedBy: game.white.id })
  expect((await client`SELECT revision FROM active_games WHERE id = ${game.id}`)[0]?.revision).toBe(2)
  await second.remove(game.id)
  expect(await client`SELECT user_id FROM active_game_players`).toHaveLength(0)
})

pgTest('stale revisions cannot overwrite or delete a newer snapshot', async () => {
  const current = store(), game = await snapshot(); await current.load(); await current.save(game)
  await client`UPDATE active_games SET revision = revision + 1 WHERE id = ${game.id}`
  await expect(current.save({ ...game, drawOfferedBy: game.white.id })).rejects.toThrow('Stale active game revision')
  await expect(current.remove(game.id)).rejects.toThrow('Stale active game deletion')
  expect((await client`SELECT snapshot FROM active_games WHERE id = ${game.id}`)[0]?.snapshot.drawOfferedBy).toBeNull()
})

pgTest('leadership assignments survive SQL recovery and cannot become ordinary or war games', async () => {
  const first = store(), game = await snapshot()
  game.leadershipMatchId = game.id
  await first.load(); await first.save(game)
  await expect(first.save({ ...game, leadershipMatchId: undefined })).rejects.toThrow('participants or assignment changed')
  await expect(first.save({ ...game, leadershipMatchId: undefined, warMatchId: game.id })).rejects.toThrow('participants or assignment changed')
  await first.close()
  const recovered = store()
  expect(await recovered.load()).toEqual([game])
  await recovered.save({ ...game, drawOfferedBy: game.white.id })
  expect((await client`SELECT snapshot FROM active_games WHERE id = ${game.id}`)[0]?.snapshot.leadershipMatchId).toBe(game.id)
})

pgTest('engine lease excludes a second writer and fencing rejects an obsolete owner', async () => {
  const first = store(), second = store(), game = await snapshot()
  await first.load(); await first.save(game)
  await expect(second.load()).rejects.toThrow('Another chess engine')
  await client`UPDATE active_engine_owner SET token = ${crypto.randomUUID()} WHERE id = true`
  await expect(first.save(game)).rejects.toThrow('ownership changed')
  await first.close()
  expect(await second.load()).toEqual([game])
})

pgTest('a lost response after commit retries its write token instead of applying another version', async () => {
  let loseResponse = false
  const proxy = new Proxy(client, { get(target, property) {
    if (property === 'begin') return async (...args: unknown[]) => {
      const result = await Reflect.apply(client.begin, client, args)
      if (loseResponse) { loseResponse = false; throw Object.assign(new Error('lost commit response'), { code: 'ECONNRESET' }) }
      return result
    }
    const value = Reflect.get(target, property)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const current = store(proxy), game = await snapshot(); await current.load(); await current.save(game)
  loseResponse = true
  await current.save({ ...game, drawOfferedBy: game.white.id })
  expect((await client`SELECT revision FROM active_games WHERE id = ${game.id}`)[0]?.revision).toBe(2)
})

pgTest('completed game IDs cannot be resurrected as new active games', async () => {
  const current = store(), game = await snapshot(); await current.load()
  await client`INSERT INTO games (id, white_id, black_id) VALUES (${game.id}, ${game.white.id}, ${game.black.id})`
  await expect(current.save(game)).rejects.toThrow('already completed')
  expect(await client`SELECT id FROM active_games`).toHaveLength(0)
})

pgTest('a fresh backend recovers from PostgreSQL alone and commits the result before deleting its active row', async () => {
  const sample = await snapshot(), players = [sample.white, sample.black]
  const until = async (condition: () => boolean) => { const started = Date.now(); while (!condition()) { if (Date.now() - started > 5000) throw new Error('Recovery test timed out'); await Bun.sleep(10) } }
  const boot = async () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-pg-recovery-')); temporary.push(directory)
    const ready = join(directory, 'ready.json')
    const runtimeUrl = new URL(url); runtimeUrl.searchParams.set('options', `-c search_path=${namespace}`)
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL('../ws/fixtures/postgresRecovery.worker.ts', import.meta.url))], {
      env: { ...process.env, DATABASE_URL: runtimeUrl.toString(), RECOVERY_PG_URL: url, RECOVERY_PG_SCHEMA: namespace, RECOVERY_PG_PLAYERS: JSON.stringify(players), RECOVERY_PG_READY: ready }, stdout: 'ignore', stderr: 'pipe' })
    children.push(child); await until(() => existsSync(ready) || child.exitCode !== null)
    if (!existsSync(ready)) throw new Error(await new Response(child.stderr).text())
    return { child, port: JSON.parse(readFileSync(ready, 'utf8')).port as number }
  }
  const connect = async (port: number, player: typeof sample.white) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/chess`), messages: any[] = []; sockets.push(ws)
    ws.addEventListener('message', event => messages.push(JSON.parse(String(event.data))))
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('WebSocket failed')) })
    const send = (data: unknown) => ws.send(JSON.stringify(data))
    const next = async (type: string) => { try { await until(() => messages.some(message => message.type === type)) } catch { for (const child of children) { if (child.exitCode === null) child.kill(9); await child.exited }; throw new Error(`Waiting for ${type}: ${JSON.stringify(messages)} ${await new Response(children[children.length - 1]!.stderr as ReadableStream<Uint8Array>).text()}`) }; return messages.splice(messages.findIndex(message => message.type === type), 1)[0] }
    send({ type: 'authenticate', token: await authJwt.decorator.jwt.sign({ sub: player.id }) }); await next('authenticated')
    return { send, next, player }
  }
  const first = await boot(), a = await connect(first.port, sample.white), b = await connect(first.port, sample.black)
  a.send({ type: 'join_queue' }); await a.next('queue_joined'); b.send({ type: 'join_queue' })
  const info = await a.next('game_start'); await b.next('game_start')
  const white = info.color === 'w' ? a : b, black = info.color === 'w' ? b : a, requestId = crypto.randomUUID()
  white.send({ type: 'move', gameId: info.gameId, ply: 0, requestId, from: 'e2', to: 'e4' })
  const moved = await white.next('move'); await black.next('move')
  const [persisted] = await client`SELECT snapshot FROM active_games WHERE id = ${info.gameId}`
  expect(persisted?.snapshot.fen).toBe(moved.fen)
  first.child.kill(9); await first.child.exited; await Bun.sleep(80)
  const second = await boot(), restored = await connect(second.port, white.player), opponent = await connect(second.port, black.player)
  const resumed = await restored.next('game_resumed'); await opponent.next('game_resumed')
  expect(resumed).toMatchObject({ gameId: info.gameId, fen: moved.fen, pgn: moved.pgn, ply: 1, color: 'w' })
  expect(resumed.clock.blackMs).toBeLessThan(persisted!.snapshot.clock.blackMs)
  restored.send({ type: 'resign', gameId: info.gameId }); expect((await restored.next('game_over')).persistence).toBe('saved'); await opponent.next('game_over')
  expect((await restored.next('game_saved')).bountyReward.status).toBe('short_game')
  expect((await client`SELECT result FROM games WHERE id = ${info.gameId}`)[0]?.result).toBe('black')
  expect(await client`SELECT id FROM active_games WHERE id = ${info.gameId}`).toHaveLength(0)
  expect(await client`SELECT game_id FROM game_rewards WHERE game_id = ${info.gameId}`).toHaveLength(1)
}, 15000)


pgTest('legacy files import into PostgreSQL with backups and no remaining runtime disk dependency', async () => {
  const game = await snapshot(), directory = mkdtempSync(join(tmpdir(), 'chess-pg-recovery-')); temporary.push(directory)
  const legacy = new FileActiveGameStore(join(directory, 'legacy'))
  legacy.save(game)
  const targetUrl = new URL(url); targetUrl.searchParams.set('options', `-c search_path=${namespace}`)
  const worker = Bun.spawn([process.execPath, fileURLToPath(new URL('../../scripts/migrate-active-games.ts', import.meta.url))], {
    env: { ...process.env, DATABASE_URL: targetUrl.toString(), ACTIVE_GAMES_DIR: legacy.directory,
      GAME_RESULTS_DIR: join(directory, 'results'), ACTIVE_IMPORT_BACKUP_DIR: join(directory, 'backups') }, stdout: 'pipe', stderr: 'pipe' })
  children.push(worker)
  const exit = await worker.exited
  if (exit !== 0) throw new Error(await new Response(worker.stderr).text())
  expect((await client`SELECT snapshot FROM active_games WHERE id = ${game.id}`)[0]?.snapshot).toEqual(game)
  expect(existsSync(join(legacy.directory, `${game.id}.json`))).toBe(false)
  const backups = readdirSync(join(directory, 'backups'))
  expect(existsSync(join(directory, 'backups', backups[0]!, 'active', `${game.id}.json`))).toBe(true)
}, 15000)
