import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { ResultOutbox } from './resultOutbox'
import type { CompletedGame } from './gameRepository'

const directories: string[] = []
const stores: ResultOutbox[] = []
function directory() {
  const value = mkdtempSync(join(tmpdir(), 'chess-outbox-test-'))
  directories.push(value)
  return value
}
function store(options: ConstructorParameters<typeof ResultOutbox>[0]) {
  const result = new ResultOutbox(options)
  stores.push(result)
  return result
}
function record(): CompletedGame {
  return { id: crypto.randomUUID(), whiteId: crypto.randomUUID(), blackId: crypto.randomUUID(),
    result: 'white', pgn: '[Result "1-0"]\n\n1. e4 1-0',
    startedAt: '2026-11-08T10:00:00.000Z', endedAt: '2026-11-08T10:01:00.000Z' }
}
afterEach(async () => {
  await Promise.all(stores.splice(0).map(item => item.stop()))
  for (const value of directories.splice(0)) {
    const target = resolve(value)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('chess-outbox-test-')) throw new Error('Unsafe test cleanup path')
    rmSync(target, { recursive: true, force: true })
  }
})

test('journals synchronously before database acknowledgement and deletes only after success', async () => {
  const dir = directory(), game = record()
  const gate = Promise.withResolvers<void>()
  let saved = false
  const outbox = store({ directory: dir, write: () => gate.promise, onSaved: () => { saved = true } })
  outbox.start()
  await outbox.flush()
  outbox.enqueue(game)
  expect(JSON.parse(readFileSync(join(dir, `${game.id}.json`), 'utf8'))).toEqual(game)
  expect(saved).toBe(false)
  gate.resolve()
  await outbox.flush()
  expect(saved).toBe(true)
  expect(readdirSync(dir)).toEqual([])
})

test('database outage leaves a durable record which a new worker replays', async () => {
  const dir = directory(), game = record()
  const failed = store({ directory: dir, write: async () => { throw new Error('offline') } })
  failed.start(); await failed.flush()
  failed.enqueue(game); await failed.flush(); await failed.stop()
  expect(readdirSync(dir)).toContain(`${game.id}.json`)
  const written: CompletedGame[] = []
  const recovered = store({ directory: dir, write: async row => { written.push(row) } })
  recovered.start(); await recovered.flush()
  expect(written).toEqual([game])
  expect(readdirSync(dir)).toEqual([])
})

test('duplicate enqueue is coalesced and conflicting results cannot overwrite the journal', async () => {
  const dir = directory(), game = record()
  let count = 0
  const outbox = store({ directory: dir, write: async () => { count++ } })
  outbox.enqueue(game); outbox.enqueue({ ...game })
  expect(() => outbox.enqueue({ ...game, result: 'black' })).toThrow()
  expect(JSON.parse(readFileSync(join(dir, `${game.id}.json`), 'utf8')).result).toBe('white')
  outbox.start(); await outbox.flush()
  expect(count).toBe(1)
})

test('retry after an ambiguous commit preserves one logical result', async () => {
  const dir = directory(), game = record(), database = new Map<string, CompletedGame>()
  let first = true
  const outbox = store({ directory: dir, write: async row => {
    database.set(row.id, row)
    if (first) { first = false; throw new Error('connection lost after commit') }
  } })
  outbox.enqueue(game); outbox.start(); await outbox.flush()
  expect(readdirSync(dir)).toContain(`${game.id}.json`)
  await outbox.flush()
  expect(database.size).toBe(1)
  expect(readdirSync(dir)).toEqual([])
})

test('corrupt journal entries stop startup instead of being silently deleted', () => {
  const dir = directory()
  writeFileSync(join(dir, 'broken.json'), '{broken', 'utf8')
  const outbox = store({ directory: dir, write: async () => {} })
  expect(() => outbox.start()).toThrow()
  expect(readdirSync(dir)).toContain('broken.json')
})
