import { afterAll, beforeAll, expect, test } from 'bun:test'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { Chess } from 'chess.js'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { authJwt } from '../auth/jwt'
import { createGameRoutes } from '../routes/games'
import { createPlayerRepository, createPlayerRoutes } from '../routes/players'
import { createGameRepository, type CompletedGame } from './gameRepository'
import { ResultOutbox } from './resultOutbox'
import { migrateWarDeadlines } from './migrateWarDeadlines'
import { createWarDeadlineProcessor } from './warDeadlines'
import { migrateWarSettlement } from './migrateWarSettlement'
import { migrateBounty } from './migrateBounty'
import { crewTotalBounty } from './bounty'
import * as schema from './schema'

const enabled = process.env.RUN_POSTGRES_TESTS === '1'
const pgTest = enabled ? test : test.skip
const namespace = `chess_test_${crypto.randomUUID().replaceAll('-', '')}`
const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/grand_line_arena'
const whiteId = crypto.randomUUID(), blackId = crypto.randomUUID(), outsiderId = crypto.randomUUID()
let admin: ReturnType<typeof postgres>
let connection: ReturnType<typeof postgres>
let repository: ReturnType<typeof createGameRepository>
let created = false
let temporary: string | undefined

function connectRepository() {
  connection = postgres(url, { max: 3, connect_timeout: 5, connection: { search_path: namespace, statement_timeout: 5000 } })
  repository = createGameRepository(drizzle(connection, { schema }))
}
function makeRecord(): CompletedGame {
  const chess = new Chess(); chess.move('e4'); chess.setHeader('Result', '1/2-1/2'); chess.setHeader('EndReason', 'agreement')
  return { id: crypto.randomUUID(), whiteId, blackId, pgn: chess.pgn(), result: 'draw',
    startedAt: '2026-11-08T10:00:00.000Z', endedAt: '2026-11-08T10:00:30.000Z' }
}
beforeAll(async () => {
  if (!enabled) return
  admin = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} })
  await admin.unsafe(`CREATE SCHEMA "${namespace}"`)
  created = true
  connectRepository()
  await connection.unsafe("CREATE TYPE game_result AS ENUM ('white','black','draw','ongoing')")
  await connection.unsafe('CREATE TABLE users (id uuid PRIMARY KEY, username varchar(32) NOT NULL, bounty integer NOT NULL DEFAULT 0)')
  await connection.unsafe(`CREATE TABLE games (id uuid PRIMARY KEY, white_id uuid NOT NULL REFERENCES users(id),
    black_id uuid NOT NULL REFERENCES users(id), pgn text NOT NULL DEFAULT '', result game_result NOT NULL DEFAULT 'ongoing',
    rating_change_white integer, rating_change_black integer, started_at timestamp NOT NULL DEFAULT now(), ended_at timestamp)`)
  await connection.unsafe(`CREATE TABLE war_matches (id uuid PRIMARY KEY, war_id uuid NOT NULL, board_number integer NOT NULL DEFAULT 1,
    white_id uuid NOT NULL REFERENCES users(id), black_id uuid NOT NULL REFERENCES users(id), game_id uuid REFERENCES games(id), result text NOT NULL DEFAULT 'pending')`)
  await connection.unsafe('CREATE TABLE crews (id uuid PRIMARY KEY, total_bounty integer NOT NULL DEFAULT 0, disbanded_at timestamp)')
  await connection.unsafe('CREATE TABLE crew_members (user_id uuid REFERENCES users(id), crew_id uuid REFERENCES crews(id))')
  await connection.unsafe(`CREATE TABLE crew_wars (id uuid PRIMARY KEY, challenger_crew_id uuid NOT NULL REFERENCES crews(id),
    defender_crew_id uuid NOT NULL REFERENCES crews(id), status text NOT NULL DEFAULT 'active', matches_per_side integer NOT NULL DEFAULT 1,
    winner_crew_id uuid, started_at timestamp NOT NULL DEFAULT now(), ended_at timestamp)`)
  await connection.unsafe(`CREATE TABLE war_fighters (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), war_id uuid NOT NULL REFERENCES crew_wars(id),
    crew_id uuid NOT NULL REFERENCES crews(id), user_id uuid NOT NULL REFERENCES users(id), position integer NOT NULL)`)
  await migrateWarSettlement(connection)
  await migrateWarDeadlines(connection); await migrateWarDeadlines(connection)
  await migrateBounty(connection)
  await migrateBounty(connection)
  await connection`INSERT INTO users (id, username) VALUES (${whiteId}, 'White'), (${blackId}, 'Black'), (${outsiderId}, 'Outsider')`
})
afterAll(async () => {
  if (!enabled) return
  await connection?.end()
  if (created) {
    if (!/^chess_test_[a-f0-9]{32}$/.test(namespace)) throw new Error('Unsafe test schema cleanup')
    await admin.unsafe(`DROP SCHEMA "${namespace}" CASCADE`)
  }
  await admin?.end()
  if (temporary) {
    if (dirname(resolve(temporary)) !== resolve(tmpdir()) || !basename(temporary).startsWith('chess-outbox-test-')) throw new Error('Unsafe test cleanup')
    rmSync(temporary, { recursive: true, force: true })
  }
})

pgTest('concurrent retries create one immutable PostgreSQL result', async () => {
  const record = makeRecord()
  await Promise.all([repository.save(record), repository.save({ ...record }), repository.save(record)])
  const rows = await connection`SELECT * FROM games WHERE id = ${record.id}`
  expect(rows.length).toBe(1)
  expect(rows[0]!.result).toBe('draw')
  expect(rows[0]!.pgn).toBe(record.pgn)
  await expect(repository.save({ ...record, result: 'white' })).rejects.toThrow('Conflicting result')
  expect((await repository.findForPlayer(record.id, whiteId))?.result).toBe('draw')
})

pgTest('a fresh worker replays an offline result and a fresh database connection reads it', async () => {
  temporary = mkdtempSync(join(tmpdir(), 'chess-outbox-test-'))
  const record = makeRecord()
  const offline = new ResultOutbox({ directory: temporary, write: async () => { throw new Error('offline') } })
  offline.enqueue(record); offline.start(); await offline.flush(); await offline.stop()
  expect(readdirSync(temporary)).toContain(`${record.id}.json`)
  const worker = Bun.spawn([process.execPath, '--eval', `
    import postgres from 'postgres';
    import { drizzle } from 'drizzle-orm/postgres-js';
    import { migrateWarDeadlines } from './migrateWarDeadlines'
import { createWarDeadlineProcessor } from './warDeadlines'
import { migrateWarSettlement } from './migrateWarSettlement'
import { migrateBounty } from './migrateBounty'
import { crewTotalBounty } from './bounty'
import * as schema from './src/db/schema.ts';
    import { createGameRepository } from './src/db/gameRepository.ts';
    import { ResultOutbox } from './src/db/resultOutbox.ts';
    import { readdirSync } from 'node:fs';
    const connection = postgres(process.env.TEST_DATABASE_URL, { connect_timeout: 5, connection: { search_path: process.env.TEST_SCHEMA } });
    const repository = createGameRepository(drizzle(connection, { schema }));
    const worker = new ResultOutbox({ directory: process.env.TEST_OUTBOX_DIR, write: record => repository.save(record) });
    worker.start(); await worker.flush(); await worker.stop(); await connection.end();
    process.exit(readdirSync(process.env.TEST_OUTBOX_DIR).length ? 1 : 0);
  `], { cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, TEST_DATABASE_URL: url, TEST_SCHEMA: namespace, TEST_OUTBOX_DIR: temporary },
    stdout: 'pipe', stderr: 'pipe' })
  expect(await worker.exited).toBe(0)
  expect(readdirSync(temporary)).toEqual([])
  await connection.end()
  connectRepository()
  const recovered = await repository.findForPlayer(record.id, blackId)
  expect(recovered?.pgn).toBe(record.pgn)
  expect(recovered?.endedAt?.toISOString()).toBe(record.endedAt)
  expect((await repository.listForPlayer(whiteId)).some(game => game.id === record.id)).toBe(true)
})

pgTest('history API authenticates callers and restricts PGNs to the two participants', async () => {
  const record = makeRecord(); await repository.save(record)
  const api = createGameRoutes(repository)
  const token = await authJwt.decorator.jwt.sign({ sub: whiteId })
  const outsiderToken = await authJwt.decorator.jwt.sign({ sub: outsiderId })
  const request = (path: string, bearer?: string) => api.handle(new Request(`http://localhost/games${path}`,
    { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} }))
  expect((await request('/')).status).toBe(401)
  expect((await request('/', 'invalid')).status).toBe(401)
  const own = await request(`/${record.id}`, token)
  expect(own.status).toBe(200)
  expect(((await own.json()) as { game: { pgn: string } }).game.pgn).toBe(record.pgn)
  expect((await request(`/${record.id}`, outsiderToken)).status).toBe(404)
  expect((await request('/?limit=51', token)).status).toBe(422)
  const list = await request('/?limit=1&offset=0', token)
  expect(((await list.json()) as { games: unknown[] }).games.length).toBe(1)
  const outsider = await request('/', outsiderToken)
  expect(((await outsider.json()) as { games: unknown[] }).games).toEqual([])
})

pgTest('bounty settlement is atomic, capped per pair and idempotent under concurrency', async () => {
  const a = crypto.randomUUID(), b = crypto.randomUUID(), crew = crypto.randomUUID()
  await connection`INSERT INTO users (id, username, bounty) VALUES (${a}, 'A', 3000000000), (${b}, 'B', 25)`
  await connection`INSERT INTO crews (id) VALUES (${crew})`
  await connection`INSERT INTO crew_members (user_id, crew_id) VALUES (${a}, ${crew}), (${b}, ${crew}), (${a}, ${crew})`
  const chess = new Chess(); for (const move of ['f3', 'e5', 'g4', 'Qh4#']) chess.move(move)
  const record = { ...makeRecord(), whiteId: a, blackId: b, result: 'black' as const, pgn: chess.pgn() }
  await Promise.all(Array.from({ length: 5 }, () => repository.save(record)))
  expect(await repository.settlement(record.id)).toMatchObject({ whiteDelta: -50, blackDelta: 100, status: 'awarded' })
  expect(await repository.playerBounties([a, b])).toEqual(expect.arrayContaining([
    { id: a, bounty: 2999999950, bountyVersion: 1 }, { id: b, bounty: 125, bountyVersion: 1 }]))
  const more = Array.from({ length: 4 }, (_, i) => ({ ...record, id: crypto.randomUUID(),
    ...(i % 2 ? { whiteId: b, blackId: a, result: 'white' as const } : {}) }))
  await Promise.all(more.map(row => repository.save(row)))
  const rewards = await Promise.all(more.map(row => repository.settlement(row.id)))
  expect(rewards.filter(row => row?.status === 'awarded')).toHaveLength(2)
  expect(rewards.filter(row => row?.status === 'pair_limit')).toHaveLength(2)
  const database = drizzle(connection, { schema })
  expect((await database.select({ total: crewTotalBounty() }).from(schema.crews))[0]?.total).toBe(3000000175)
  const tomorrow = { ...record, id: crypto.randomUUID(), endedAt: '2026-11-09T00:00:01.000Z' }
  await repository.save(tomorrow)
  expect((await repository.settlement(tomorrow.id))?.status).toBe('awarded')
  const short = { ...record, id: crypto.randomUUID(), pgn: makeRecord().pgn }
  await repository.save(short)
  expect((await repository.settlement(short.id))?.status).toBe('short_game')
  await connection`DELETE FROM crew_members WHERE user_id = ${b}`
  expect((await database.select({ total: crewTotalBounty() }).from(schema.crews))[0]?.total).toBe(2999999800)
})

pgTest('failed settlement rolls back the result and remains safe to retry', async () => {
  const a = crypto.randomUUID(), b = crypto.randomUUID()
  await connection`INSERT INTO users (id, username, bounty) VALUES (${a}, 'RollbackA', 20), (${b}, 'RollbackB', 0)`
  const chess = new Chess(); for (const move of ['f3', 'e5', 'g4', 'Qh4#']) chess.move(move)
  const record = { ...makeRecord(), whiteId: a, blackId: b, result: 'black' as const, pgn: chess.pgn() }
  await connection.unsafe(`CREATE FUNCTION fail_reward() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`)
  await connection.unsafe('CREATE TRIGGER reject_reward BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fail_reward()')
  try {
    await expect(repository.save(record)).rejects.toThrow()
    expect(await connection`SELECT id FROM games WHERE id = ${record.id}`).toHaveLength(0)
    expect(await repository.settlement(record.id)).toBeNull()
  } finally { await connection.unsafe('DROP TRIGGER reject_reward ON users') }
  await repository.save(record)
  expect(await repository.settlement(record.id)).toMatchObject({ whiteDelta: -20, blackDelta: 100, whiteAfter: 0 })
})

pgTest('overlapping opponents cannot lose updates and old saved games are not paid retroactively', async () => {
  const a = crypto.randomUUID(), b = crypto.randomUUID(), c = crypto.randomUUID()
  await connection`INSERT INTO users (id, username, bounty) VALUES (${a}, 'SharedA', 0), (${b}, 'SharedB', 100), (${c}, 'SharedC', 100)`
  const chess = new Chess(); for (const move of ['f3', 'e5', 'g4', 'Qh4#']) chess.move(move)
  const first = { ...makeRecord(), whiteId: b, blackId: a, pgn: chess.pgn(), result: 'black' as const }
  const second = { ...first, id: crypto.randomUUID(), whiteId: c }
  await Promise.all([repository.save(first), repository.save(second)])
  expect(await repository.playerBounties([a])).toEqual([{ id: a, bounty: 200, bountyVersion: 2 }])
  const legacy = { ...first, id: crypto.randomUUID() }
  await connection`INSERT INTO games (id, white_id, black_id, pgn, result, started_at, ended_at)
    VALUES (${legacy.id}, ${legacy.whiteId}, ${legacy.blackId}, ${legacy.pgn}, ${legacy.result}, ${legacy.startedAt}, ${legacy.endedAt})`
  await repository.save(legacy)
  expect(await repository.settlement(legacy.id)).toBeNull()
  expect(await repository.playerBounties([a])).toEqual([{ id: a, bounty: 200, bountyVersion: 2 }])
})

pgTest('public bounty standings paginate deterministically and expose only public fields', async () => {
  const a = crypto.randomUUID(), b = crypto.randomUUID(), c = crypto.randomUUID()
  await connection`INSERT INTO users (id, username, bounty) VALUES (${a}, 'RankAlpha', 9000000000),
    (${b}, 'RankBeta', 9000000000), (${c}, 'RankGamma', 8000000000)`
  const api = createPlayerRoutes(createPlayerRepository(drizzle(connection, { schema })))
  const request = (query: string) => api.handle(new Request(`http://localhost/players/leaderboard${query}`))
  const response = await request('?limit=2')
  expect(response.status).toBe(200)
  const first = await response.json() as { players: Record<string, unknown>[]; hasMore: boolean }
  expect(first.hasMore).toBe(true)
  expect(first.players).toEqual([{ id: a, username: 'RankAlpha', bounty: 9000000000, rank: 1 },
    { id: b, username: 'RankBeta', bounty: 9000000000, rank: 2 }])
  const next = await (await request('?limit=1&offset=2')).json() as { players: { id: string; rank: number }[] }
  expect(next.players[0]).toMatchObject({ id: c, rank: 3 })
  const empty = await (await request('?offset=10000')).json() as { players: unknown[]; hasMore: boolean }
  expect(empty).toEqual({ players: [], hasMore: false })
  for (const query of ['?limit=51', '?limit=0', '?offset=-1', '?offset=1.5', '?offset=10001'])
    expect((await request(query)).status).toBe(422)
})

pgTest('bounty standings report a database outage without exposing internals', async () => {
  const api = createPlayerRoutes({ leaderboard: async () => { throw new Error('secret database details') } })
  const response = await api.handle(new Request('http://localhost/players/leaderboard'))
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: 'Bounty standings are temporarily unavailable' })
})

pgTest('war result, history and bounty commit exactly once and reject wrong assignments', async () => {
  const a = crypto.randomUUID(), b = crypto.randomUUID(), matchId = crypto.randomUUID(), warId = crypto.randomUUID()
  await connection`INSERT INTO users (id, username, bounty) VALUES (${a}, 'WarWhite', 100), (${b}, 'WarBlack', 100)`
  await connection`INSERT INTO war_matches (id, war_id, white_id, black_id) VALUES (${matchId}, ${warId}, ${a}, ${b})`
  const chess = new Chess(); for (const move of ['f3', 'e5', 'g4', 'Qh4#']) chess.move(move)
  const ca = crypto.randomUUID(), cb = crypto.randomUUID()
  await connection`INSERT INTO crews (id) VALUES (${ca}), (${cb})`
  await connection`INSERT INTO crew_wars (id, challenger_crew_id, defender_crew_id) VALUES (${warId}, ${ca}, ${cb})`
  await connection`INSERT INTO war_fighters (war_id, crew_id, user_id, position) VALUES (${warId}, ${ca}, ${a}, 0), (${warId}, ${cb}, ${b}, 0)`
  const record = { ...makeRecord(), id: matchId, warMatchId: matchId, whiteId: a, blackId: b, pgn: chess.pgn(), result: 'black' as const }
  await Promise.all([repository.save(record), repository.save(record), repository.save(record)])
  const [match] = await connection`SELECT game_id, result FROM war_matches WHERE id = ${matchId}`
  expect(match).toMatchObject({ game_id: matchId, result: 'black' })
  expect(await repository.playerBounties([a, b])).toEqual(expect.arrayContaining([
    { id: a, bounty: 50, bountyVersion: 1 }, { id: b, bounty: 400, bountyVersion: 2 }]))
  expect((await repository.findForPlayer(matchId, a))?.pgn).toBe(chess.pgn())
  const other = crypto.randomUUID()
  await connection`INSERT INTO war_matches (id, war_id, white_id, black_id) VALUES (${other}, ${warId}, ${b}, ${a})`
  await expect(repository.save({ ...record, id: other, warMatchId: other })).rejects.toThrow('War match result conflicts')
  expect(await connection`SELECT id FROM games WHERE id = ${other}`).toHaveLength(0)
  expect((await connection`SELECT result FROM war_matches WHERE id = ${other}`)[0]?.result).toBe('pending')
})
