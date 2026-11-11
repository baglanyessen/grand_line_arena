import { afterAll, beforeAll, expect, test } from 'bun:test'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { createCrewRepository } from './crewRepository'
import { createCrewRoutes } from '../routes/crew'
import { migrateCrews } from './migrateCrews'
import { migrateCrewArchive } from './migrateCrewArchive'
import { createWarRepository } from './warRepository'
import { createWarRoutes } from '../routes/war'
import { migrateLeadership } from './migrateLeadership'
import { createLeadershipRepository } from './leadershipRepository'
import { createLeadershipRoutes } from '../routes/leadership'
import { createLeadershipDeadlineProcessor } from './leadershipDeadlines'
import { migrateActiveGames } from './migrateActiveGames'
import { migrateWarDeadlines } from './migrateWarDeadlines'
import { createWarDeadlineProcessor } from './warDeadlines'
import { migrateWarSettlement } from './migrateWarSettlement'
import { migrateBounty } from './migrateBounty'
import { createGameRepository } from './gameRepository'
import { Chess } from 'chess.js'
import { migrateWarRosters } from './migrateWarRosters'
import { authJwt } from '../auth/jwt'
import * as schema from './schema'

const enabled = process.env.RUN_POSTGRES_TESTS === '1', pgTest = enabled ? test : test.skip
const namespace = `crew_test_${crypto.randomUUID().replaceAll('-', '')}`
const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/grand_line_arena'
let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>
let repository: ReturnType<typeof createCrewRepository>
let created = false

async function account() {
  const id = crypto.randomUUID()
  await client`INSERT INTO users (id, username) VALUES (${id}, ${id})`
  return id
}
async function crew(name = `Crew-${crypto.randomUUID()}`) {
  const captain = await account()
  const result = await repository.create(captain, { name, tag: crypto.randomUUID().slice(0, 10) })
  return { ...result, captain }
}
function request(api: ReturnType<typeof createCrewRoutes>, method: string, path: string, token?: string, body?: unknown) {
  return api.handle(new Request(`http://localhost/crews${path}`, { method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) }))
}

beforeAll(async () => {
  if (!enabled) return
  admin = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} })
  await admin.unsafe(`CREATE SCHEMA "${namespace}"`); created = true
  client = postgres(url, { max: 8, connect_timeout: 5, onnotice: () => {}, connection: { search_path: namespace, statement_timeout: 5000 } })
  await client.unsafe("CREATE TYPE crew_role AS ENUM ('captain','officer','member')")
  await client.unsafe(`CREATE TABLE users (id uuid PRIMARY KEY, username varchar(64) NOT NULL, bounty bigint NOT NULL DEFAULT 0, avatar_url text)`)
  await client.unsafe(`CREATE TABLE crews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(64) NOT NULL UNIQUE,
    tag varchar(10) NOT NULL UNIQUE, description text DEFAULT '', captain_id uuid NOT NULL REFERENCES users(id),
    total_bounty bigint NOT NULL DEFAULT 0, max_members integer NOT NULL DEFAULT 30, created_at timestamp NOT NULL DEFAULT now())`)
  await client.unsafe(`CREATE TABLE crew_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
    crew_id uuid NOT NULL REFERENCES crews(id), role crew_role NOT NULL DEFAULT 'member', joined_at timestamp NOT NULL DEFAULT now())`)
  await migrateCrews(client); await migrateCrews(client)
  await migrateCrewArchive(client); await migrateCrewArchive(client)
  await client.unsafe("CREATE TYPE war_status AS ENUM ('pending','active','completed','cancelled')")
  await client.unsafe(`CREATE TABLE crew_wars (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    challenger_crew_id uuid NOT NULL REFERENCES crews(id), defender_crew_id uuid NOT NULL REFERENCES crews(id),
    status war_status NOT NULL DEFAULT 'pending', matches_per_side integer NOT NULL DEFAULT 5,
    winner_crew_id uuid REFERENCES crews(id), started_at timestamp NOT NULL DEFAULT now(), ended_at timestamp)`)
  await client.unsafe("CREATE TYPE war_match_result AS ENUM ('white','black','draw','pending')")
  await client.unsafe(`CREATE TABLE war_matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), war_id uuid NOT NULL REFERENCES crew_wars(id),
    white_id uuid NOT NULL REFERENCES users(id), black_id uuid NOT NULL REFERENCES users(id), game_id uuid,
    result war_match_result NOT NULL DEFAULT 'pending')`)
  await migrateWarRosters(client); await migrateWarRosters(client)
  await client.unsafe("CREATE TYPE game_result AS ENUM ('white','black','draw','ongoing')")
  await client.unsafe(`CREATE TABLE games (id uuid PRIMARY KEY, white_id uuid NOT NULL REFERENCES users(id), black_id uuid NOT NULL REFERENCES users(id),
    pgn text NOT NULL DEFAULT '', result game_result NOT NULL DEFAULT 'ongoing', rating_change_white integer, rating_change_black integer,
    started_at timestamp NOT NULL DEFAULT now(), ended_at timestamp)`)
  await migrateBounty(client)
  await migrateActiveGames(client)
  await migrateWarSettlement(client); await migrateWarSettlement(client)
  await migrateWarDeadlines(client); await migrateWarDeadlines(client)
  await migrateLeadership(client); await migrateLeadership(client)
  repository = createCrewRepository(drizzle(client, { schema }))
})
afterAll(async () => {
  if (!enabled) return
  await client?.end()
  if (created) {
    if (!/^crew_test_[a-f0-9]{32}$/.test(namespace)) throw new Error('Unsafe test cleanup')
    await admin.unsafe(`DROP SCHEMA "${namespace}" CASCADE`)
  }
  await admin?.end()
})

pgTest('own crew lookup works beyond the discovery page and authenticates the caller', async () => {
  for (let i = 0; i < 21; i++) await crew(`AAA-${String(i).padStart(2, '0')}`)
  const own = await crew('ZZZ Own crew'), api = createCrewRoutes(repository)
  const token = await authJwt.decorator.jwt.sign({ sub: own.captain })
  expect((await request(api, 'GET', '/mine')).status).toBe(401)
  expect((await request(api, 'GET', '/mine', 'invalid')).status).toBe(401)
  const response = await request(api, 'GET', '/mine', token)
  expect(response.status).toBe(200)
  const data = await response.json() as { crew: { id: string }; members: { userId: string }[]; myRole: string }
  expect(data.crew.id).toBe(own.crew.id); expect(data.myRole).toBe('captain')
  expect(data.members.map(member => member.userId)).toEqual([own.captain])
  const first = await (await request(api, 'GET', '/?limit=20')).json() as { crews: { id: string }[]; hasMore: boolean }
  expect(first.hasMore).toBe(true); expect(first.crews.some(row => row.id === own.crew.id)).toBe(false)
  const last = await (await request(api, 'GET', '/?limit=20&offset=20')).json() as { crews: { id: string }[] }
  expect(last.crews.some(row => row.id === own.crew.id)).toBe(true)
  expect(await repository.mine(await account())).toEqual({ crew: null, members: [], myRole: null })
})

pgTest('concurrent joins to the last slot never exceed crew capacity', async () => {
  const target = await crew(), ids = await Promise.all(Array.from({ length: 12 }, account))
  await client`UPDATE crews SET max_members = 2 WHERE id = ${target.crew.id}`
  const results = await Promise.allSettled(ids.map(id => repository.join(id, target.crew.id)))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect((await repository.detail(target.crew.id)).members).toHaveLength(2)
  const [joined] = await client`SELECT user_id FROM crew_members WHERE crew_id = ${target.crew.id} AND role = 'member'`
  await repository.leave(joined!.user_id, target.crew.id)
  const next = ids.find(id => id !== joined!.user_id)!
  await repository.join(next, target.crew.id)
  expect((await repository.detail(target.crew.id)).members).toHaveLength(2)
})

pgTest('simultaneous create and joins produce one membership and no orphan crew', async () => {
  const a = await crew(), b = await crew(), user = await account()
  const name = `Race-${crypto.randomUUID()}`
  const results = await Promise.allSettled([repository.create(user, { name, tag: crypto.randomUUID().slice(0, 10) }),
    repository.join(user, a.crew.id), repository.join(user, b.crew.id)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(await client`SELECT id FROM crew_members WHERE user_id = ${user}`).toHaveLength(1)
  const createdCrew = await client`SELECT id FROM crews WHERE name = ${name}`
  if (createdCrew.length) expect((await repository.mine(user)).myRole).toBe('captain')
  else expect((await repository.mine(user)).myRole).toBe('member')
  await expect((async () => { await client`INSERT INTO crew_members (user_id, crew_id) VALUES (${user}, ${b.crew.id})` })()).rejects.toThrow()
})

pgTest('failed captain insertion rolls back crew creation', async () => {
  const user = await account(), name = `Rollback-${crypto.randomUUID()}`
  await client.unsafe(`CREATE FUNCTION fail_membership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`)
  await client.unsafe('CREATE TRIGGER reject_membership BEFORE INSERT ON crew_members FOR EACH ROW EXECUTE FUNCTION fail_membership()')
  try {
    await expect(repository.create(user, { name, tag: 'ROLLBACK' })).rejects.toThrow()
    expect(await client`SELECT id FROM crews WHERE name = ${name}`).toHaveLength(0)
    expect(await repository.mine(user)).toMatchObject({ crew: null })
  } finally { await client.unsafe('DROP TRIGGER reject_membership ON crew_members') }
})

pgTest('crew permissions protect the captain and officers and ignore client identity spoofing', async () => {
  const target = await crew(), member = await account(), officer = await account(), otherOfficer = await account()
  for (const id of [member, officer, otherOfficer]) await repository.join(id, target.crew.id)
  await client`UPDATE crew_members SET role = 'officer' WHERE user_id IN (${officer}, ${otherOfficer})`
  const api = createCrewRoutes(repository), token = await authJwt.decorator.jwt.sign({ sub: member })
  expect((await request(api, 'DELETE', `/${target.crew.id}/members/${officer}`, token, { userId: target.captain })).status).toBe(403)
  await expect(repository.kick(officer, target.crew.id, otherOfficer)).rejects.toMatchObject({ status: 403 })
  await expect(repository.kick(officer, target.crew.id, target.captain)).rejects.toMatchObject({ status: 403 })
  await expect(repository.leave(target.captain, target.crew.id)).rejects.toMatchObject({ status: 409 })
  await repository.kick(officer, target.crew.id, member)
  expect((await repository.mine(member)).crew).toBeNull()
  await repository.kick(target.captain, target.crew.id, otherOfficer)
  expect((await repository.mine(otherOfficer)).crew).toBeNull()
})

pgTest('API validates identities, reports conflicts and never hides lookup errors as no crew', async () => {
  const target = await crew(), newcomer = await account(), api = createCrewRoutes(repository)
  const token = await authJwt.decorator.jwt.sign({ sub: newcomer })
  expect((await request(api, 'POST', '/', token, { name: target.crew.name, tag: 'UNIQUE' })).status).toBe(409)
  expect((await repository.mine(newcomer)).crew).toBeNull()
  expect((await request(api, 'POST', '/', token, { name: '   ', tag: '  ' })).status).toBe(400)
  expect((await request(api, 'POST', '/not-a-uuid/join', token)).status).toBe(422)
  expect((await request(api, 'GET', '/?limit=51')).status).toBe(422)
  expect((await request(api, 'POST', `/${crypto.randomUUID()}/join`, token)).status).toBe(404)
  const failing = createCrewRoutes({ ...repository, mine: async () => { throw new Error('secret connection details') } })
  const failed = await request(failing, 'GET', '/mine', token)
  expect(failed.status).toBe(503)
  expect(await failed.json()).toEqual({ error: 'Crew service is temporarily unavailable' })
})

pgTest('migration refuses legacy duplicate memberships without deleting data', async () => {
  const a = await crew(), b = await crew(), user = await account()
  await repository.join(user, a.crew.id)
  await client.unsafe('ALTER TABLE crew_members DROP CONSTRAINT crew_members_user_unique')
  const [duplicate] = await client`INSERT INTO crew_members (user_id, crew_id) VALUES (${user}, ${b.crew.id}) RETURNING id`
  try {
    await expect(migrateCrews(client)).rejects.toThrow('Crew migration blocked')
    expect(await client`SELECT id FROM crew_members WHERE user_id = ${user}`).toHaveLength(2)
  } finally {
    await client`DELETE FROM crew_members WHERE id = ${duplicate!.id}`
    await migrateCrews(client)
  }
})

pgTest('captain can promote and demote officers; other roles cannot grant permissions', async () => {
  const target = await crew(), member = await account(), outsider = await account()
  await repository.join(member, target.crew.id)
  const api = createCrewRoutes(repository)
  const captainToken = await authJwt.decorator.jwt.sign({ sub: target.captain })
  const memberToken = await authJwt.decorator.jwt.sign({ sub: member })
  const path = `/${target.crew.id}/members/${member}/role`
  expect((await request(api, 'PUT', path, undefined, { role: 'officer' })).status).toBe(401)
  expect((await request(api, 'PUT', path, memberToken, { role: 'officer', actorId: target.captain })).status).toBe(403)
  expect((await request(api, 'PUT', path, captainToken, { role: 'captain' })).status).toBe(422)
  expect((await request(api, 'PUT', path, captainToken, { role: 'officer' })).status).toBe(200)
  expect((await repository.mine(member)).myRole).toBe('officer')
  await expect(repository.setRole(member, target.crew.id, member, 'member')).rejects.toMatchObject({ status: 403 })
  await expect(repository.setRole(target.captain, target.crew.id, outsider, 'officer')).rejects.toMatchObject({ status: 404 })
  await expect(repository.setRole(target.captain, target.crew.id, target.captain, 'member')).rejects.toMatchObject({ status: 409 })
  await repository.setRole(target.captain, target.crew.id, member, 'member')
  expect((await repository.mine(member)).myRole).toBe('member')
})

pgTest('transfer changes both captain references and immediately changes authority', async () => {
  const target = await crew(), successor = await account(), member = await account(), outsider = await account()
  await repository.join(successor, target.crew.id); await repository.join(member, target.crew.id)
  const api = createCrewRoutes(repository), path = `/${target.crew.id}/transfer`
  const captainToken = await authJwt.decorator.jwt.sign({ sub: target.captain })
  const memberToken = await authJwt.decorator.jwt.sign({ sub: successor })
  expect((await request(api, 'POST', path, undefined, { userId: successor })).status).toBe(401)
  expect((await request(api, 'POST', path, memberToken, { userId: successor })).status).toBe(403)
  expect((await request(api, 'POST', path, captainToken, { userId: 'invalid' })).status).toBe(422)
  expect((await request(api, 'POST', path, captainToken, { userId: outsider })).status).toBe(404)
  expect((await request(api, 'POST', path, captainToken, { userId: target.captain })).status).toBe(400)
  expect((await request(api, 'POST', path, captainToken, { userId: successor })).status).toBe(200)
  const detail = await repository.detail(target.crew.id)
  expect(detail.crew.captainId).toBe(successor)
  expect(detail.members.filter(member => member.role === 'captain').map(member => member.userId)).toEqual([successor])
  expect((await repository.mine(target.captain)).myRole).toBe('officer')
  await expect(repository.setRole(target.captain, target.crew.id, member, 'officer')).rejects.toMatchObject({ status: 403 })
  await expect(repository.kick(target.captain, target.crew.id, successor)).rejects.toMatchObject({ status: 403 })
  await expect(repository.leave(successor, target.crew.id)).rejects.toMatchObject({ status: 409 })
  await repository.setRole(successor, target.crew.id, member, 'officer')
  await repository.leave(target.captain, target.crew.id)
  expect((await repository.mine(target.captain)).crew).toBeNull()
})

pgTest('two concurrent captain transfers leave exactly one consistent captain', async () => {
  const target = await crew(), a = await account(), b = await account()
  await repository.join(a, target.crew.id); await repository.join(b, target.crew.id)
  const results = await Promise.allSettled([repository.transferCaptain(target.captain, target.crew.id, a),
    repository.transferCaptain(target.captain, target.crew.id, b)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const detail = await repository.detail(target.crew.id)
  expect(detail.members.filter(member => member.role === 'captain').map(member => member.userId)).toEqual([detail.crew.captainId])
  expect([a, b].some(id => id === detail.crew.captainId)).toBe(true)
  expect((await repository.mine(target.captain)).myRole).toBe('officer')
})

pgTest('a failed captain pointer update rolls back both membership role changes', async () => {
  const target = await crew(), successor = await account()
  await repository.join(successor, target.crew.id)
  await repository.setRole(target.captain, target.crew.id, successor, 'officer')
  await client.unsafe(`CREATE FUNCTION fail_captain_transfer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`)
  await client.unsafe('CREATE TRIGGER reject_transfer BEFORE UPDATE OF captain_id ON crews FOR EACH ROW EXECUTE FUNCTION fail_captain_transfer()')
  try {
    await expect(repository.transferCaptain(target.captain, target.crew.id, successor)).rejects.toThrow()
    const detail = await repository.detail(target.crew.id)
    expect(detail.crew.captainId).toBe(target.captain)
    expect((await repository.mine(target.captain)).myRole).toBe('captain')
    expect((await repository.mine(successor)).myRole).toBe('officer')
  } finally { await client.unsafe('DROP TRIGGER reject_transfer ON crews') }
  await repository.transferCaptain(target.captain, target.crew.id, successor)
  expect((await repository.mine(successor)).myRole).toBe('captain')
})

pgTest('captain transfer racing with departure cannot produce a captain outside the crew', async () => {
  const target = await crew(), successor = await account()
  await repository.join(successor, target.crew.id)
  const results = await Promise.allSettled([repository.transferCaptain(target.captain, target.crew.id, successor),
    repository.leave(successor, target.crew.id)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const detail = await repository.detail(target.crew.id)
  expect(detail.members.filter(member => member.role === 'captain').map(member => member.userId)).toEqual([detail.crew.captainId])
})

pgTest('only the captain can disband; all members are freed and history and bounty remain', async () => {
  const target = await crew(), member = await account(), officer = await account()
  await repository.join(member, target.crew.id); await repository.join(officer, target.crew.id)
  await repository.setRole(target.captain, target.crew.id, officer, 'officer')
  await client`UPDATE users SET bounty = 100 WHERE id = ${member}`
  const api = createCrewRoutes(repository), path = `/${target.crew.id}/disband`
  expect((await request(api, 'POST', path)).status).toBe(401)
  for (const id of [member, officer, await account()]) {
    const token = await authJwt.decorator.jwt.sign({ sub: id })
    expect((await request(api, 'POST', path, token, { userId: target.captain })).status).toBe(403)
  }
  const token = await authJwt.decorator.jwt.sign({ sub: target.captain })
  expect((await request(api, 'POST', path, token)).status).toBe(200)
  expect((await request(api, 'POST', path, token)).status).toBe(200)
  const archived = await repository.detail(target.crew.id)
  expect(archived.crew.disbandedAt).not.toBeNull(); expect(archived.members).toHaveLength(0)
  expect(archived.crew.totalBounty).toBe(100)
  for (const id of [target.captain, member, officer]) expect((await repository.mine(id)).crew).toBeNull()
  expect((await repository.list(target.crew.name, 20, 0))).toHaveLength(0)
  await expect(repository.join(await account(), target.crew.id)).rejects.toMatchObject({ status: 409 })
  const next = await crew(); await repository.join(member, next.crew.id)
  await client`UPDATE users SET bounty = 200 WHERE id = ${member}`
  expect((await repository.detail(target.crew.id)).crew.totalBounty).toBe(100)
  await migrateCrews(client) // Re-running earlier migrations must recognize archived crews.
})

pgTest('pending and active wars block disbanding on both sides; completed history survives', async () => {
  const wars = createWarRepository(drizzle(client, { schema }))
  for (const status of ['pending', 'active'] as const) {
    const a = await crew(), b = await crew()
    const war = await wars.declare(a.captain, b.crew.id)
    if (status === 'active') await wars.accept(b.captain, war.id)
    for (const side of [a, b]) await expect(repository.disband(side.captain, side.crew.id)).rejects.toMatchObject({ status: 409 })
    await client`UPDATE crew_wars SET status = 'completed', winner_crew_id = ${a.crew.id} WHERE id = ${war.id}`
    await repository.disband(a.captain, a.crew.id); await repository.disband(b.captain, b.crew.id)
    expect(await client`SELECT id FROM crew_wars WHERE id = ${war.id} AND winner_crew_id = ${a.crew.id}`).toHaveLength(1)
    expect((await repository.detail(a.crew.id)).crew.name).toBe(a.crew.name)
  }
})

pgTest('failed roster removal rolls back the archive timestamp and all memberships', async () => {
  const target = await crew()
  await client.unsafe(`CREATE FUNCTION fail_disband() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`)
  await client.unsafe('CREATE TRIGGER reject_disband BEFORE DELETE ON crew_members FOR EACH ROW EXECUTE FUNCTION fail_disband()')
  try {
    await expect(repository.disband(target.captain, target.crew.id)).rejects.toThrow()
    const detail = await repository.detail(target.crew.id)
    expect(detail.crew.disbandedAt).toBeNull(); expect(detail.members).toHaveLength(1)
  } finally { await client.unsafe('DROP TRIGGER reject_disband ON crew_members') }
})

pgTest('war declaration racing with disband cannot create a war involving an archived crew', async () => {
  const wars = createWarRepository(drizzle(client, { schema }))
  const a = await crew(), b = await crew()
  const results = await Promise.allSettled([repository.disband(a.captain, a.crew.id), wars.declare(b.captain, a.crew.id)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const archived = (await repository.detail(a.crew.id)).crew.disbandedAt !== null
  expect(await client`SELECT id FROM crew_wars WHERE defender_crew_id = ${a.crew.id}`).toHaveLength(archived ? 0 : 1)
})

pgTest('acceptance and disband serialize, and archived crews reject later war and roster actions', async () => {
  const wars = createWarRepository(drizzle(client, { schema }))
  const a = await crew(), b = await crew(), successor = await account()
  await repository.join(successor, a.crew.id)
  const war = await wars.declare(b.captain, a.crew.id)
  const results = await Promise.allSettled([repository.disband(a.captain, a.crew.id), wars.accept(a.captain, war.id)])
  expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled'])
  await client`UPDATE crew_wars SET status = 'cancelled' WHERE id = ${war.id}`
  await repository.disband(a.captain, a.crew.id)
  await expect(wars.declare(b.captain, a.crew.id)).rejects.toMatchObject({ status: 409 })
  await expect(wars.accept(a.captain, war.id)).rejects.toMatchObject({ status: 409 })
  await expect(repository.transferCaptain(a.captain, a.crew.id, successor)).rejects.toMatchObject({ status: 409 })
  await expect(repository.setRole(a.captain, a.crew.id, successor, 'officer')).rejects.toMatchObject({ status: 409 })
})

pgTest('joining and disbanding concurrently leave no membership in the archive', async () => {
  const target = await crew(), user = await account()
  await Promise.allSettled([repository.join(user, target.crew.id), repository.disband(target.captain, target.crew.id)])
  const detail = await repository.detail(target.crew.id)
  expect(detail.crew.disbandedAt).not.toBeNull(); expect(detail.members).toHaveLength(0)
  expect((await repository.mine(user)).crew).toBeNull()
})

pgTest('opposite declarations serialize into one pending war', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), a = await crew(), b = await crew()
  const results = await Promise.allSettled([wars.declare(a.captain, b.crew.id), wars.declare(b.captain, a.crew.id)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(await client`SELECT id FROM crew_wars WHERE challenger_crew_id IN (${a.crew.id}, ${b.crew.id})`).toHaveLength(1)
})

pgTest('war authority follows the current captain after leadership transfer', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), a = await crew(), b = await crew(), successor = await account()
  await repository.join(successor, b.crew.id)
  const war = await wars.declare(a.captain, b.crew.id)
  await repository.transferCaptain(b.captain, b.crew.id, successor)
  await expect(wars.accept(b.captain, war.id)).rejects.toMatchObject({ status: 403 })
  await expect(wars.declare(b.captain, a.crew.id)).rejects.toMatchObject({ status: 403 })
  await wars.accept(successor, war.id)
  expect((await client`SELECT status FROM crew_wars WHERE id = ${war.id}`)[0]?.status).toBe('active')
})

pgTest('war list API authenticates, paginates and limits results to the current crew', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), api = createWarRoutes(wars)
  const a = await crew(), b = await crew(), c = await crew(), member = await account()
  await repository.join(member, a.crew.id)
  const first = await wars.declare(a.captain, b.crew.id), second = await wars.declare(a.captain, c.crew.id)
  await wars.declare(b.captain, c.crew.id)
  const token = await authJwt.decorator.jwt.sign({ sub: member })
  const get = (query = '', bearer?: string) => api.handle(new Request(`http://localhost/wars/${query}`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} }))
  expect((await get()).status).toBe(401)
  expect((await get('', 'invalid')).status).toBe(401)
  const data = await (await get('?limit=1', token)).json() as { wars: { id: string; challengerName: string; defenderName: string }[]; hasMore: boolean }
  expect(data.hasMore).toBe(true); expect(data.wars).toHaveLength(1)
  expect(data.wars[0]?.challengerName).toBe(a.crew.name)
  const next = await (await get('?limit=1&offset=1', token)).json() as { wars: { id: string }[]; hasMore: boolean }
  expect(next.hasMore).toBe(false)
  expect(new Set([data.wars[0]!.id, next.wars[0]!.id])).toEqual(new Set([first.id, second.id]))
  const noCrew = await authJwt.decorator.jwt.sign({ sub: await account() })
  expect(await (await get('', noCrew)).json()).toEqual({ wars: [], hasMore: false })
  for (const query of ['?limit=51', '?offset=-1', '?status=invalid']) expect((await get(query, token)).status).toBe(422)
})

pgTest('withdrawal and rejection enforce the correct captain and release disband restrictions', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), api = createWarRoutes(wars)
  const a = await crew(), b = await crew(), member = await account()
  await repository.join(member, a.crew.id)
  const war = await wars.declare(a.captain, b.crew.id)
  const post = async (id: string, action: string, userId?: string) => {
    const token = userId ? await authJwt.decorator.jwt.sign({ sub: userId }) : null
    return api.handle(new Request(`http://localhost/wars/${id}/${action}`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} }))
  }
  expect((await post(war.id, 'cancel')).status).toBe(401)
  expect((await post(war.id, 'cancel', member)).status).toBe(403)
  expect((await post(war.id, 'cancel', b.captain)).status).toBe(403)
  expect((await post(war.id, 'decline', a.captain)).status).toBe(403)
  expect((await post('invalid', 'cancel', a.captain)).status).toBe(422)
  expect((await post(war.id, 'cancel', a.captain)).status).toBe(200)
  expect((await post(war.id, 'cancel', a.captain)).status).toBe(409)
  const history = await wars.listForPlayer(a.captain, 'history', 20, 0)
  expect(history[0]).toMatchObject({ id: war.id, status: 'cancelled' })
  expect(history[0]?.endedAt).not.toBeNull()
  expect(await wars.listForPlayer(a.captain, 'pending', 20, 0)).toHaveLength(0)
  const again = await wars.declare(a.captain, b.crew.id)
  expect((await post(again.id, 'decline', b.captain)).status).toBe(200)
  await repository.disband(a.captain, a.crew.id); await repository.disband(b.captain, b.crew.id)
})

pgTest('acceptance racing with withdrawal commits one terminal decision', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), a = await crew(), b = await crew()
  const war = await wars.declare(a.captain, b.crew.id)
  const results = await Promise.allSettled([wars.accept(b.captain, war.id), wars.closePending(a.captain, war.id, 'cancel')])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const [row] = await client`SELECT status, ended_at FROM crew_wars WHERE id = ${war.id}`
  if (row!.status === 'active') {
    expect(row!.ended_at).toBeNull()
    await expect(wars.closePending(b.captain, war.id, 'decline')).rejects.toMatchObject({ status: 409 })
  } else {
    expect(row!.status).toBe('cancelled'); expect(row!.ended_at).not.toBeNull()
    await expect(wars.accept(b.captain, war.id)).rejects.toMatchObject({ status: 409 })
  }
})

pgTest('cancellation follows captain transfer and concurrent close requests cannot reopen a war', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), a = await crew(), b = await crew(), successor = await account()
  await repository.join(successor, a.crew.id)
  const war = await wars.declare(a.captain, b.crew.id)
  await repository.transferCaptain(a.captain, a.crew.id, successor)
  await expect(wars.closePending(a.captain, war.id, 'cancel')).rejects.toMatchObject({ status: 403 })
  const results = await Promise.allSettled([wars.closePending(successor, war.id, 'cancel'), wars.closePending(b.captain, war.id, 'decline')])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect((await wars.listForPlayer(successor, 'history', 20, 0))[0]?.status).toBe('cancelled')
})

pgTest('fighter submission validates captain, distinct count and membership without partial writes', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), api = createWarRoutes(wars), a = await crew(), b = await crew(), member = await account()
  await repository.join(member, a.crew.id)
  const war = await wars.declare(a.captain, b.crew.id, 2)
  await expect(wars.submitFighters(a.captain, war.id, [a.captain, member])).rejects.toMatchObject({ status: 409 })
  await wars.accept(b.captain, war.id)
  await expect(wars.submitFighters(member, war.id, [a.captain, member])).rejects.toMatchObject({ status: 403 })
  for (const ids of [[a.captain], [a.captain, a.captain], [a.captain, b.captain]])
    await expect(wars.submitFighters(a.captain, war.id, ids)).rejects.toMatchObject({ status: 400 })
  expect((await wars.detailForPlayer(member, war.id)).fighters).toHaveLength(0)
  await expect(wars.detailForPlayer(await account(), war.id)).rejects.toMatchObject({ status: 403 })
  const token = await authJwt.decorator.jwt.sign({ sub: a.captain })
  const submit = (body: unknown, bearer?: string) => api.handle(new Request(`http://localhost/wars/${war.id}/fighters`,
    { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) }))
  expect((await submit({ fighterIds: [a.captain, member] })).status).toBe(401)
  expect((await submit({ fighterIds: ['invalid'] }, token)).status).toBe(422)
  expect((await submit({ fighterIds: [a.captain, member] }, token)).status).toBe(200)
  expect((await wars.detailForPlayer(member, war.id)).fighters).toHaveLength(2)
})

pgTest('simultaneous roster delivery creates one stable ordered set of alternating-color matches', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), a = await crew(), b = await crew(), am = await account(), bm = await account()
  await repository.join(am, a.crew.id); await repository.join(bm, b.crew.id)
  const war = await wars.declare(a.captain, b.crew.id, 2); await wars.accept(b.captain, war.id)
  await Promise.all([wars.submitFighters(a.captain, war.id, [am, a.captain]), wars.submitFighters(b.captain, war.id, [bm, b.captain]),
    wars.submitFighters(a.captain, war.id, [am, a.captain]), wars.submitFighters(b.captain, war.id, [bm, b.captain])])
  const detail = await wars.detailForPlayer(am, war.id)
  expect(detail.fighters).toHaveLength(4)
  expect(detail.matches.map(match => [match.boardNumber, match.whiteId, match.blackId])).toEqual([[1, am, bm], [2, b.captain, a.captain]])
  const ids = detail.matches.map(match => match.id)
  const fresh = createWarRepository(drizzle(client, { schema }))
  await fresh.submitFighters(a.captain, war.id, [am, a.captain])
  expect((await fresh.detailForPlayer(bm, war.id)).matches.map(match => match.id)).toEqual(ids)
  await expect(fresh.submitFighters(a.captain, war.id, [a.captain, am])).rejects.toMatchObject({ status: 409 })
  await expect(repository.leave(am, a.crew.id)).rejects.toMatchObject({ status: 409 })
  await expect(repository.kick(a.captain, a.crew.id, am)).rejects.toMatchObject({ status: 409 })
  await client`UPDATE crew_wars SET status = 'completed' WHERE id = ${war.id}`
  await repository.leave(am, a.crew.id)
  expect(await client`SELECT id FROM war_fighters WHERE war_id = ${war.id}`).toHaveLength(4)
})

pgTest('before pairings rosters can be replaced and departing fighters must be replaced', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), a = await crew(), b = await crew(), member = await account()
  await repository.join(member, a.crew.id)
  const war = await wars.declare(a.captain, b.crew.id, 1); await wars.accept(b.captain, war.id)
  await wars.submitFighters(a.captain, war.id, [a.captain])
  await wars.submitFighters(a.captain, war.id, [member])
  await repository.leave(member, a.crew.id)
  expect(await wars.submitFighters(b.captain, war.id, [b.captain])).toEqual({ ready: false })
  expect((await wars.detailForPlayer(a.captain, war.id)).matches).toHaveLength(0)
  expect(await wars.submitFighters(a.captain, war.id, [a.captain])).toEqual({ ready: true })
})

pgTest('pairing failure rolls back the second roster and can be retried safely', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), a = await crew(), b = await crew()
  const war = await wars.declare(a.captain, b.crew.id, 1); await wars.accept(b.captain, war.id)
  await wars.submitFighters(a.captain, war.id, [a.captain])
  await client.unsafe(`CREATE FUNCTION fail_pairing() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`)
  await client.unsafe('CREATE TRIGGER reject_pairing BEFORE INSERT ON war_matches FOR EACH ROW EXECUTE FUNCTION fail_pairing()')
  try {
    await expect(wars.submitFighters(b.captain, war.id, [b.captain])).rejects.toThrow()
    const detail = await wars.detailForPlayer(a.captain, war.id)
    expect(detail.fighters).toHaveLength(1); expect(detail.matches).toHaveLength(0)
  } finally { await client.unsafe('DROP TRIGGER reject_pairing ON war_matches') }
  await wars.submitFighters(b.captain, war.id, [b.captain])
  expect((await wars.detailForPlayer(a.captain, war.id)).matches).toHaveLength(1)
})

pgTest('a departure racing with second roster submission cannot leave an ineligible paired fighter', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), a = await crew(), b = await crew(), member = await account()
  await repository.join(member, a.crew.id)
  const war = await wars.declare(a.captain, b.crew.id, 1); await wars.accept(b.captain, war.id)
  await wars.submitFighters(a.captain, war.id, [member])
  await Promise.allSettled([repository.leave(member, a.crew.id), wars.submitFighters(b.captain, war.id, [b.captain])])
  const detail = await wars.detailForPlayer(a.captain, war.id)
  if (detail.matches.length) expect((await repository.mine(member)).crew?.id).toBe(a.crew.id)
  else expect(detail.fighters.some(fighter => fighter.userId === member)).toBe(false)
})

pgTest('war entry lookup accepts only assigned players on an active unfinished board', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), a = await crew(), b = await crew()
  const war = await wars.declare(a.captain, b.crew.id, 1); await wars.accept(b.captain, war.id)
  await wars.submitFighters(a.captain, war.id, [a.captain]); await wars.submitFighters(b.captain, war.id, [b.captain])
  const match = (await wars.detailForPlayer(a.captain, war.id)).matches[0]!
  expect(await wars.matchForPlayer(a.captain, match.id)).toEqual({ id: match.id, whiteId: a.captain, blackId: b.captain })
  await expect(wars.matchForPlayer(await account(), match.id)).rejects.toMatchObject({ status: 403 })
  await client`UPDATE war_matches SET result = 'white' WHERE id = ${match.id}`
  await expect(wars.matchForPlayer(a.captain, match.id)).rejects.toMatchObject({ status: 409 })
  await client`UPDATE war_matches SET result = 'pending' WHERE id = ${match.id}`
  await client`UPDATE crew_wars SET status = 'completed' WHERE id = ${war.id}`
  await expect(wars.matchForPlayer(b.captain, match.id)).rejects.toMatchObject({ status: 409 })
})

async function pairedWar(size = 2, sides?: { a: Awaited<ReturnType<typeof crew>>; b: Awaited<ReturnType<typeof crew>> }) {
  const a = sides?.a ?? await crew(), b = sides?.b ?? await crew()
  const wars = createWarRepository(drizzle(client, { schema }))
  if (!sides) for (let i = 1; i < size; i++) { await repository.join(await account(), a.crew.id); await repository.join(await account(), b.crew.id) }
  const aa = (await repository.detail(a.crew.id)).members.map(member => member.userId)
  const bb = (await repository.detail(b.crew.id)).members.map(member => member.userId)
  const war = await wars.declare(a.captain, b.crew.id, size); await wars.accept(b.captain, war.id)
  await wars.submitFighters(a.captain, war.id, aa); await wars.submitFighters(b.captain, war.id, bb)
  const detail = await wars.detailForPlayer(a.captain, war.id)
  return { a, b, war, wars, matches: detail.matches, gameRepo: createGameRepository(drizzle(client, { schema })) }
}

function boardRecord(match: { id: string; whiteId: string; blackId: string }, result: 'white' | 'black' | 'draw', short = false) {
  const chess = new Chess()
  if (!short) for (const move of ['e4', 'e5', 'Nf3', 'Nc6']) chess.move(move)
  chess.setHeader('Result', result === 'white' ? '1-0' : result === 'black' ? '0-1' : '1/2-1/2')
  return { id: match.id, warMatchId: match.id, whiteId: match.whiteId, blackId: match.blackId, pgn: chess.pgn(), result,
    startedAt: '2026-11-08T10:00:00.000Z', endedAt: '2026-11-08T10:05:00.000Z' }
}

pgTest('war progress stays active until every board ends, then a tied war awards each fighter once', async () => {
  const setup = await pairedWar()
  const first = boardRecord(setup.matches[0]!, 'white'), last = boardRecord(setup.matches[1]!, 'white')
  await setup.gameRepo.save(first)
  let detail = await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)
  expect(detail.war).toMatchObject({ status: 'active', challengerScoreHalf: 2, defenderScoreHalf: 0 })
  expect(detail.settlement).toBeNull(); expect(detail.rewards).toHaveLength(0)
  await setup.gameRepo.save(last)
  await Promise.all([setup.gameRepo.save(first), setup.gameRepo.save(last)])
  detail = await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)
  expect(detail.war).toMatchObject({ status: 'completed', winnerCrewId: null, challengerScoreHalf: 2, defenderScoreHalf: 2 })
  expect(detail.war.endedAt?.toISOString()).toBe(last.endedAt)
  expect(detail.settlement?.status).toBe('awarded')
  expect(detail.rewards.map(reward => reward.delta)).toEqual([100, 100, 100, 100])
  const balances = await setup.gameRepo.playerBounties(detail.fighters.map(fighter => fighter.userId))
  expect(balances.reduce((sum, player) => sum + player.bounty, 0)).toBe(600)
})

pgTest('concurrent final results settle one crew victory and free the roster after completion', async () => {
  const setup = await pairedWar()
  const records = [boardRecord(setup.matches[0]!, 'white'), boardRecord(setup.matches[1]!, 'black')]
  await Promise.all([...records, ...records].map(record => setup.gameRepo.save(record)))
  const detail = await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)
  expect(detail.war).toMatchObject({ status: 'completed', winnerCrewId: setup.a.crew.id, challengerScoreHalf: 4, defenderScoreHalf: 0 })
  expect(detail.rewards.filter(reward => reward.crewId === setup.a.crew.id).map(reward => reward.delta)).toEqual([200, 200])
  expect(detail.rewards.filter(reward => reward.crewId === setup.b.crew.id).map(reward => reward.delta)).toEqual([0, 0])
  const member = detail.fighters.find(fighter => fighter.crewId === setup.a.crew.id && fighter.userId !== setup.a.captain)!
  await repository.leave(member.userId, setup.a.crew.id)
  await repository.disband(setup.a.captain, setup.a.crew.id)
  expect((await repository.detail(setup.a.crew.id)).crew.totalBounty).toBe(300)
  expect((await setup.gameRepo.warSettlementForGame(records[1]!.id))?.rewards).toHaveLength(4)
})

pgTest('a war reward write failure rolls back the final board, score and bonuses, then retries cleanly', async () => {
  const setup = await pairedWar(), first = boardRecord(setup.matches[0]!, 'white'), last = boardRecord(setup.matches[1]!, 'black')
  await setup.gameRepo.save(first)
  const before = await setup.gameRepo.playerBounties((await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)).fighters.map(fighter => fighter.userId))
  await client.unsafe(`CREATE FUNCTION fail_war_reward() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`)
  await client.unsafe('CREATE TRIGGER reject_war_reward BEFORE INSERT ON war_rewards FOR EACH ROW EXECUTE FUNCTION fail_war_reward()')
  try {
    await expect(setup.gameRepo.save(last)).rejects.toThrow()
    const detail = await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)
    expect(detail.war).toMatchObject({ status: 'active', challengerScoreHalf: 2, defenderScoreHalf: 0 })
    expect(detail.matches[1]?.result).toBe('pending'); expect(detail.settlement).toBeNull(); expect(detail.rewards).toHaveLength(0)
    expect(await setup.gameRepo.findForPlayer(last.id, last.whiteId)).toBeNull()
    expect(await setup.gameRepo.playerBounties(before.map(player => player.id))).toEqual(before)
  } finally { await client.unsafe('DROP TRIGGER reject_war_reward ON war_rewards') }
  await setup.gameRepo.save(last)
  expect((await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)).war.status).toBe('completed')
})

async function leadershipSeries(accept = true) {
  const own = await crew(), challenger = await account(), outsider = await account()
  await repository.join(challenger, own.crew.id)
  const database = drizzle(client, { schema }), leadership = createLeadershipRepository(database)
  const challenge = await leadership.create(challenger, own.crew.id)
  if (accept) await leadership.respond(own.captain, challenge.id, 'accept')
  const detail = async () => (await leadership.list(challenger, own.crew.id))[0]!
  return { ...own, challenger, outsider, leadership, challenge, detail, database, gameRepo: createGameRepository(database) }
}

function leadershipRecord(match: { id: string; whiteId: string; blackId: string }, result: 'white' | 'black' | 'draw') {
  const { warMatchId, ...record } = boardRecord(match, result)
  return { ...record, leadershipMatchId: match.id }
}

pgTest('leadership requests enforce membership, captain consent, one open series and cooldown', async () => {
  const own = await crew(), a = await account(), b = await account(), outsider = await account()
  await repository.join(a, own.crew.id); await repository.join(b, own.crew.id)
  const leadership = createLeadershipRepository(drizzle(client, { schema }))
  await expect(leadership.create(own.captain, own.crew.id)).rejects.toMatchObject({ status: 403 })
  await expect(leadership.create(outsider, own.crew.id)).rejects.toMatchObject({ status: 403 })
  const attempts = await Promise.allSettled([leadership.create(a, own.crew.id), leadership.create(b, own.crew.id)])
  expect(attempts.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  const challenge = (await leadership.list(a, own.crew.id))[0]!
  await expect(leadership.list(outsider, own.crew.id)).rejects.toMatchObject({ status: 403 })
  await expect(leadership.respond(challenge.challengerId, challenge.id, 'accept')).rejects.toMatchObject({ status: 403 })
  await expect(leadership.respond(own.captain, challenge.id, 'cancel')).rejects.toMatchObject({ status: 403 })
  await leadership.respond(own.captain, challenge.id, 'decline')
  await expect(leadership.create(challenge.challengerId, own.crew.id)).rejects.toMatchObject({ status: 409 })
  const other = challenge.challengerId === a ? b : a, next = await leadership.create(other, own.crew.id)
  await leadership.respond(other, next.id, 'cancel')
  expect((await leadership.list(other, own.crew.id))[0]?.status).toBe('cancelled')
})

pgTest('leadership freezes participants and captain changes, and excludes crew wars', async () => {
  const setup = await leadershipSeries(false), rival = await crew(), spare = await account()
  await repository.join(spare, setup.crew.id)
  await expect(repository.leave(setup.challenger, setup.crew.id)).rejects.toMatchObject({ status: 409 })
  await expect(repository.kick(setup.captain, setup.crew.id, setup.challenger)).rejects.toMatchObject({ status: 409 })
  await expect(repository.transferCaptain(setup.captain, setup.crew.id, spare)).rejects.toMatchObject({ status: 409 })
  await expect(repository.disband(setup.captain, setup.crew.id)).rejects.toMatchObject({ status: 409 })
  const wars = createWarRepository(setup.database)
  await expect(wars.declare(rival.captain, setup.crew.id, 1)).rejects.toMatchObject({ status: 409 })
  await repository.leave(spare, setup.crew.id)
  await setup.leadership.respond(setup.challenger, setup.challenge.id, 'cancel')
  const war = await wars.declare(rival.captain, setup.crew.id, 1)
  await client`UPDATE leadership_challenges SET created_at = created_at - interval '2 days' WHERE id = ${setup.challenge.id}`
  await expect(setup.leadership.create(setup.challenger, setup.crew.id)).rejects.toMatchObject({ status: 409 })
  expect(war.status).toBe('pending')
})

pgTest('leadership alternates colors and atomically transfers both captain references exactly once', async () => {
  const setup = await leadershipSeries()
  const first = (await setup.detail()).matches[0]!
  expect(first.whiteId).toBe(setup.challenger)
  await expect(setup.leadership.checkInForPlayer(setup.outsider, first.id)).rejects.toMatchObject({ status: 403 })
  await setup.gameRepo.save(leadershipRecord(first, 'white'))
  const mid = await setup.detail(), second = mid.matches[1]!
  expect(mid).toMatchObject({ status: 'active', challengerScoreHalf: 2, captainScoreHalf: 0 })
  expect(second.whiteId).toBe(setup.captain); expect(second.blackId).toBe(setup.challenger)
  expect((await repository.detail(setup.crew.id)).crew.captainId).toBe(setup.captain)
  const last = leadershipRecord(second, 'black')
  await Promise.all([setup.gameRepo.save(last), setup.gameRepo.save(last)])
  const final = await setup.detail(), crewDetail = await repository.detail(setup.crew.id)
  expect(final).toMatchObject({ status: 'completed', winnerId: setup.challenger, challengerScoreHalf: 4, captainScoreHalf: 0 })
  expect(final.matches).toHaveLength(2)
  expect(crewDetail.crew.captainId).toBe(setup.challenger)
  expect(crewDetail.members.find(row => row.userId === setup.challenger)?.role).toBe('captain')
  expect(crewDetail.members.find(row => row.userId === setup.captain)?.role).toBe('officer')
  const rewards = await client`SELECT * FROM game_rewards WHERE game_id IN (${first.id}, ${second.id})`
  expect(rewards).toHaveLength(2)
  await setup.gameRepo.save(last)
  expect([...(await client`SELECT * FROM game_rewards WHERE game_id IN (${first.id}, ${second.id})`)]).toEqual([...rewards])
  await expect(repository.setRole(setup.captain, setup.crew.id, setup.challenger, 'member')).rejects.toMatchObject({ status: 403 })
})

pgTest('three drawn leadership games retain the captain; a third-game lead wins the series', async () => {
  for (const results of [['draw', 'draw', 'draw'], ['white', 'white', 'white']] as const) {
    const setup = await leadershipSeries()
    for (const result of results) {
      const current = (await setup.detail()).matches.find(row => row.result === 'pending')!
      await setup.gameRepo.save(leadershipRecord(current, result))
    }
    const tied = results[0] === 'draw', detail = await setup.detail()
    expect(detail).toMatchObject({ status: 'completed', winnerId: tied ? setup.captain : setup.challenger,
      challengerScoreHalf: tied ? 3 : 4, captainScoreHalf: tied ? 3 : 2, endReason: tied ? 'captain_holds_tie' : 'series_won' })
    expect(detail.matches).toHaveLength(3)
    expect((await repository.detail(setup.crew.id)).crew.captainId).toBe(detail.winnerId!)
  }
})

pgTest('failed leadership transfer rolls back the final game, reward, score and roles together', async () => {
  const setup = await leadershipSeries()
  await setup.gameRepo.save(leadershipRecord((await setup.detail()).matches[0]!, 'white'))
  const match = (await setup.detail()).matches[1]!, record = leadershipRecord(match, 'black')
  const before = await client`SELECT id, bounty, bounty_version FROM users WHERE id IN (${setup.captain}, ${setup.challenger}) ORDER BY id`
  await client.unsafe(`CREATE FUNCTION fail_leadership_transfer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`)
  await client.unsafe(`CREATE TRIGGER fail_leadership_transfer BEFORE UPDATE OF captain_id ON crews FOR EACH ROW EXECUTE FUNCTION fail_leadership_transfer()`)
  try {
    await expect(setup.gameRepo.save(record)).rejects.toThrow()
    expect(await client`SELECT id FROM games WHERE id = ${match.id}`).toHaveLength(0)
    expect([...(await client`SELECT id, bounty, bounty_version FROM users WHERE id IN (${setup.captain}, ${setup.challenger}) ORDER BY id`)]).toEqual([...before])
    expect((await setup.detail()).matches[1]).toMatchObject({ result: 'pending', gameId: null })
    expect((await repository.mine(setup.captain)).myRole).toBe('captain')
  } finally { await client.unsafe('DROP TRIGGER fail_leadership_transfer ON crews') }
  await setup.gameRepo.save(record)
  expect((await repository.mine(setup.challenger)).myRole).toBe('captain')
})

pgTest('leadership deadlines expire requests and preserve the captain when neither player arrives', async () => {
  const setup = await leadershipSeries(false), processor = createLeadershipDeadlineProcessor(setup.database), deadline = new Date(Date.now() - 1000)
  await client`UPDATE leadership_challenges SET request_deadline = ${deadline.toISOString()} WHERE id = ${setup.challenge.id}`
  await expect(setup.leadership.respond(setup.captain, setup.challenge.id, 'accept')).rejects.toMatchObject({ status: 409 })
  await processor.sweep(deadline)
  expect(await setup.detail()).toMatchObject({ status: 'expired', endReason: 'request_expired' })
  const active = await leadershipSeries(), match = (await active.detail()).matches[0]!
  await client`UPDATE leadership_matches SET join_deadline = ${deadline.toISOString()} WHERE id = ${match.id}`
  await Promise.all([processor.expire(active.challenge.id), processor.expire(active.challenge.id)])
  expect(await active.detail()).toMatchObject({ status: 'completed', winnerId: active.captain, endReason: 'no_contest', challengerScoreHalf: 0, captainScoreHalf: 0 })
  expect(await client`SELECT id FROM games WHERE id = ${match.id}`).toHaveLength(0)
  expect((await repository.mine(active.captain)).myRole).toBe('captain')
})

pgTest('leadership attendance is versioned and two opponent no-shows transfer captaincy without fabricated games', async () => {
  const setup = await leadershipSeries(), processor = createLeadershipDeadlineProcessor(setup.database)
  const first = (await setup.detail()).matches[0]!
  const old = await setup.leadership.checkInForPlayer(setup.challenger, first.id), fresh = await setup.leadership.checkInForPlayer(setup.challenger, first.id)
  await setup.leadership.clearReady(setup.challenger, first.id, old.readyAt)
  expect((await setup.detail()).matches[0]?.whiteReadyAt?.toISOString()).toBe(fresh.readyAt)
  for (let i = 0; i < 2; i++) {
    const current = (await setup.detail()).matches[i]!
    if (i) await setup.leadership.checkInForPlayer(setup.challenger, current.id)
    await client`UPDATE leadership_matches SET join_deadline = ${new Date(Date.now() - 1000).toISOString()} WHERE id = ${current.id}`
    await processor.expire(setup.challenge.id)
    expect(await client`SELECT id FROM games WHERE id = ${current.id}`).toHaveLength(0)
  }
  expect(await setup.detail()).toMatchObject({ status: 'completed', winnerId: setup.challenger, challengerScoreHalf: 4 })
  expect((await repository.mine(setup.challenger)).myRole).toBe('captain')
  expect((await repository.detail(setup.crew.id)).crew.totalBounty).toBe(0)
})

pgTest('leadership deadlines protect engine and SQL games and ignore obsolete ownership', async () => {
  const setup = await leadershipSeries(), match = (await setup.detail()).matches[0]!, processor = createLeadershipDeadlineProcessor(setup.database)
  await client`UPDATE leadership_matches SET join_deadline = ${new Date(Date.now() - 1000).toISOString()} WHERE id = ${match.id}`
  await processor.expire(setup.challenge.id, new Date(), id => id === match.id)
  expect((await setup.detail()).status).toBe('active')
  const owner = crypto.randomUUID()
  await client`INSERT INTO active_engine_owner (id, token) VALUES (true, ${owner}) ON CONFLICT (id) DO UPDATE SET token = excluded.token`
  await client`INSERT INTO active_games (id, revision, write_token, snapshot) VALUES (${match.id}, 1, ${crypto.randomUUID()}, '{}'::jsonb)`
  await processor.expire(setup.challenge.id, new Date(), () => false, owner)
  expect((await setup.detail()).status).toBe('active')
  await client`DELETE FROM active_games WHERE id = ${match.id}`
  await processor.expire(setup.challenge.id, new Date(), () => false, crypto.randomUUID())
  expect((await setup.detail()).status).toBe('active')
  await processor.expire(setup.challenge.id, new Date(), () => false, owner)
  expect((await setup.detail()).status).toBe('completed')
})

pgTest('leadership HTTP routes require authentication, isolate crew history and validate actions', async () => {
  const setup = await leadershipSeries(false), api = createLeadershipRoutes(setup.leadership)
  const call = async (path: string, actor?: string, method = 'GET') => api.handle(new Request(`http://localhost/leadership${path}`, {
    method, headers: actor ? { authorization: `Bearer ${await authJwt.decorator.jwt.sign({ sub: actor })}` } : {} }))
  expect((await call(`/crew/${setup.crew.id}`)).status).toBe(401)
  expect((await call(`/crew/${setup.crew.id}`, setup.outsider)).status).toBe(403)
  expect((await call(`/crew/${setup.crew.id}`, setup.challenger)).status).toBe(200)
  expect((await call(`/${setup.challenge.id}/accept`, setup.challenger, 'POST')).status).toBe(403)
  expect((await call(`/${setup.challenge.id}/accept`, setup.captain, 'POST')).status).toBe(200)
  expect((await call(`/${setup.challenge.id}/delete`, setup.captain, 'POST')).status).toBe(422)
})

pgTest('war bonus farming limits do not prevent war completion or overwrite match bounty', async () => {
  const first = await pairedWar(1)
  await first.gameRepo.save(boardRecord(first.matches[0]!, 'white'))
  const second = await pairedWar(1, first)
  await second.gameRepo.save(boardRecord(second.matches[0]!, 'white'))
  let detail = await second.wars.detailForPlayer(second.a.captain, second.war.id)
  expect(detail.war.status).toBe('completed'); expect(detail.settlement?.status).toBe('pair_limit')
  expect(detail.rewards.every(reward => reward.delta === 0)).toBe(true)
  const third = await pairedWar(1, first)
  await third.gameRepo.save(boardRecord(third.matches[0]!, 'white', true))
  detail = await third.wars.detailForPlayer(third.a.captain, third.war.id)
  expect(detail.war.status).toBe('completed'); expect(detail.settlement?.status).toBe('short_games')
  expect(detail.rewards.every(reward => reward.delta === 0)).toBe(true)
})

pgTest('war bonuses respect the maximum bounty and record the actual capped reward', async () => {
  const setup = await pairedWar(1)
  await client`UPDATE users SET bounty = 999999999850 WHERE id = ${setup.a.captain}`
  await setup.gameRepo.save(boardRecord(setup.matches[0]!, 'white'))
  const detail = await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)
  expect(detail.rewards.find(reward => reward.userId === setup.a.captain)).toMatchObject({ delta: 50, bountyAfter: 1000000000000 })
})

pgTest('saved pre-upgrade war boards reconcile progress and completion without repaying match bounty', async () => {
  const setup = await pairedWar(1), record = boardRecord(setup.matches[0]!, 'draw')
  await client`INSERT INTO games (id, white_id, black_id, pgn, result, started_at, ended_at)
    VALUES (${record.id}, ${record.whiteId}, ${record.blackId}, ${record.pgn}, ${record.result}, ${record.startedAt}, ${record.endedAt})`
  await client`UPDATE war_matches SET game_id = ${record.id}, result = 'draw' WHERE id = ${record.id}`
  await setup.gameRepo.save(record); await setup.gameRepo.save(record)
  const detail = await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)
  expect(detail.war).toMatchObject({ status: 'completed', challengerScoreHalf: 1, defenderScoreHalf: 1, winnerCrewId: null })
  expect(detail.rewards.map(reward => reward.delta)).toEqual([100, 100])
  expect(await client`SELECT game_id FROM game_rewards WHERE game_id = ${record.id}`).toHaveLength(0)
  expect((await setup.gameRepo.playerBounties([record.whiteId, record.blackId])).map(player => player.bounty)).toEqual([100, 100])
})

pgTest('request expiry is inclusive, rejects late acceptance and releases both crews', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), a = await crew(), b = await crew()
  const war = await wars.declare(a.captain, b.crew.id, 1), processor = createWarDeadlineProcessor(drizzle(client, { schema }))
  const deadline = new Date(Date.now() - 1000)
  await client`UPDATE crew_wars SET request_deadline = ${deadline.toISOString()} WHERE id = ${war.id}`
  await expect(wars.accept(b.captain, war.id)).rejects.toMatchObject({ status: 409 })
  await processor.expire(war.id, new Date(deadline.getTime() - 1))
  expect((await wars.detailForPlayer(a.captain, war.id)).war.status).toBe('pending')
  await Promise.all([processor.expire(war.id, deadline), processor.expire(war.id, deadline)])
  expect((await wars.detailForPlayer(a.captain, war.id)).war).toMatchObject({ status: 'cancelled', endReason: 'request_expired' })
  await repository.disband(a.captain, a.crew.id); await repository.disband(b.captain, b.crew.id)
})

pgTest('roster deadlines award a technical win to the only full side, with no bounty bonus', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), a = await crew(), b = await crew()
  const war = await wars.declare(a.captain, b.crew.id, 1); await wars.accept(b.captain, war.id)
  await wars.submitFighters(a.captain, war.id, [a.captain])
  const deadline = new Date(Date.now() - 1000)
  await client`UPDATE crew_wars SET roster_deadline = ${deadline.toISOString()} WHERE id = ${war.id}`
  await expect(wars.submitFighters(b.captain, war.id, [b.captain])).rejects.toMatchObject({ status: 409 })
  await createWarDeadlineProcessor(drizzle(client, { schema })).sweep()
  const detail = await wars.detailForPlayer(a.captain, war.id)
  expect(detail.war).toMatchObject({ status: 'completed', winnerCrewId: a.crew.id, endReason: 'roster_timeout', challengerScoreHalf: 2, defenderScoreHalf: 0 })
  expect(detail.settlement?.status).toBe('forfeit'); expect(detail.rewards).toHaveLength(0)
  expect((await repository.detail(a.crew.id)).crew.totalBounty).toBe(0)
})

pgTest('empty rosters cancel the war; paired wars are not closed by the old roster deadline', async () => {
  const wars = createWarRepository(drizzle(client, { schema })), a = await crew(), b = await crew()
  const war = await wars.declare(a.captain, b.crew.id, 1); await wars.accept(b.captain, war.id)
  const processor = createWarDeadlineProcessor(drizzle(client, { schema })), past = new Date(Date.now() - 1000)
  await client`UPDATE crew_wars SET roster_deadline = ${past.toISOString()} WHERE id = ${war.id}`
  await processor.expire(war.id)
  expect((await wars.detailForPlayer(a.captain, war.id)).war).toMatchObject({ status: 'cancelled', endReason: 'roster_timeout', winnerCrewId: null })
  const paired = await pairedWar(1)
  await client`UPDATE crew_wars SET roster_deadline = ${past.toISOString()} WHERE id = ${paired.war.id}`
  await processor.expire(paired.war.id)
  expect((await paired.wars.detailForPlayer(paired.a.captain, paired.war.id)).war.status).toBe('active')
})

pgTest('board no-shows persist correct technical scores and never create fictitious chess games', async () => {
  const processor = createWarDeadlineProcessor(drizzle(client, { schema }))
  for (const ready of ['none', 'white', 'black', 'both']) {
    const setup = await pairedWar(1), match = setup.matches[0]!
    if (ready === 'white' || ready === 'both') await setup.wars.checkInForPlayer(match.whiteId, match.id)
    if (ready === 'black' || ready === 'both') await setup.wars.checkInForPlayer(match.blackId, match.id)
    const deadline = new Date(Date.now() - 1000)
    await client`UPDATE war_matches SET join_deadline = ${deadline.toISOString()} WHERE id = ${match.id}`
    await Promise.all([processor.expire(setup.war.id), processor.expire(setup.war.id)])
    const detail = await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)
    expect(detail.war.status).toBe('completed')
    expect(detail.war.winnerCrewId).toBe(ready === 'white' ? setup.a.crew.id : ready === 'black' ? setup.b.crew.id : null)
    expect(detail.war.challengerScoreHalf).toBe(ready === 'white' ? 2 : 0)
    expect(detail.war.defenderScoreHalf).toBe(ready === 'black' ? 2 : 0)
    expect(detail.settlement?.status).toBe('forfeit')
    expect(detail.rewards.every(reward => reward.delta === 0)).toBe(true)
    expect(await client`SELECT id FROM games WHERE id = ${match.id}`).toHaveLength(0)
  }
})

pgTest('deadline processing protects live and journaled boards and rejects new late entry', async () => {
  const setup = await pairedWar(1), match = setup.matches[0]!, processor = createWarDeadlineProcessor(drizzle(client, { schema }))
  const past = new Date(Date.now() - 1000)
  await client`UPDATE war_matches SET join_deadline = ${past.toISOString()} WHERE id = ${match.id}`
  await processor.expire(setup.war.id, new Date(), id => id === match.id)
  expect((await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)).matches[0]?.result).toBe('pending')
  await expect(setup.wars.checkInForPlayer(match.whiteId, match.id)).rejects.toMatchObject({ status: 409 })
  await processor.expire(setup.war.id)
  expect((await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)).war.status).toBe('completed')
})

pgTest('old waiting-room cleanup cannot erase attendance from a newer reconnect', async () => {
  const setup = await pairedWar(1), match = setup.matches[0]!
  const first = await setup.wars.checkInForPlayer(match.whiteId, match.id)
  const second = await setup.wars.checkInForPlayer(match.whiteId, match.id)
  expect(second.readyAt).not.toBe(first.readyAt)
  await setup.wars.clearReady(match.whiteId, match.id, first.readyAt)
  let detail = await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)
  expect(detail.matches[0]?.whiteReadyAt?.toISOString()).toBe(second.readyAt)
  await setup.wars.clearReady(match.whiteId, match.id, second.readyAt)
  detail = await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)
  expect(detail.matches[0]?.whiteReadyAt).toBeNull()
})


pgTest('deadline processing preserves SQL-backed games and rejects an obsolete engine token', async () => {
  const setup = await pairedWar(1), match = setup.matches[0]!, processor = createWarDeadlineProcessor(drizzle(client, { schema }))
  const past = new Date(Date.now() - 1000), owner = crypto.randomUUID()
  await client`UPDATE war_matches SET join_deadline = ${past.toISOString()} WHERE id = ${match.id}`
  await client`INSERT INTO active_engine_owner (id, token) VALUES (true, ${owner}) ON CONFLICT (id) DO UPDATE SET token = excluded.token`
  await client`INSERT INTO active_games (id, revision, write_token, snapshot) VALUES (${match.id}, 1, ${crypto.randomUUID()}, '{}'::jsonb)`
  await processor.expire(setup.war.id, new Date(), () => false, owner)
  expect((await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)).matches[0]?.result).toBe('pending')
  await client`DELETE FROM active_games WHERE id = ${match.id}`
  await processor.expire(setup.war.id, new Date(), () => false, crypto.randomUUID())
  expect((await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)).matches[0]?.result).toBe('pending')
  await processor.expire(setup.war.id, new Date(), () => false, owner)
  expect((await setup.wars.detailForPlayer(setup.a.captain, setup.war.id)).war.status).toBe('completed')
})
