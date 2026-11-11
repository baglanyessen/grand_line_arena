import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { migrateActiveGames } from '../src/db/migrateActiveGames'
import { PostgresActiveGameStore } from '../src/db/postgresActiveGameStore'
import { FileActiveGameStore } from '../src/ws/activeGameStore'
import { createGameRepository, validateCompletedGame } from '../src/db/gameRepository'
import * as schema from '../src/db/schema'

const client = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/grand_line_arena',
  { max: 4, connect_timeout: 5, connection: { statement_timeout: 30000 }, onnotice: () => {} })
const store = new PostgresActiveGameStore(client)
try {
  await migrateActiveGames(client)
  // The engine lease requires the running backend to be stopped while importing legacy state.
  const current = new Map((await store.load()).map(game => [game.id, game]))
  const files = new FileActiveGameStore(), legacy = files.load()
  const resultDir = resolve(process.env.GAME_RESULTS_DIR ?? fileURLToPath(new URL('../.data/game-results/', import.meta.url)))
  const resultFiles = existsSync(resultDir) ? readdirSync(resultDir).filter(file => file.endsWith('.json')) : []
  const backup = join(process.env.ACTIVE_IMPORT_BACKUP_DIR ?? fileURLToPath(new URL('../.data/import-backups/', import.meta.url)), `${Date.now()}-${crypto.randomUUID()}`)
  let imported = 0, delivered = 0
  for (const game of legacy) {
    const source = join(files.directory, `${game.id}.json`)
    mkdirSync(join(backup, 'active'), { recursive: true }); copyFileSync(source, join(backup, 'active', `${game.id}.json`))
    const [done] = await client`SELECT white_id, black_id FROM games WHERE id = ${game.id}`
    if (done) {
      if (done.white_id !== game.white.id || done.black_id !== game.black.id) throw new Error('Legacy active game conflicts with completed participants')
    } else if (current.has(game.id)) {
      if (!isDeepStrictEqual(current.get(game.id), game)) throw new Error('Legacy snapshot differs from PostgreSQL; review the backup before importing')
    } else { await store.save(game); current.set(game.id, game); imported++ }
    unlinkSync(source)
  }
  const repository = createGameRepository(drizzle(client, { schema }))
  for (const file of resultFiles) {
    const source = join(resultDir, file), record = validateCompletedGame(JSON.parse(readFileSync(source, 'utf8')))
    if (file !== `${record.id}.json`) throw new Error('Legacy result filename mismatch')
    mkdirSync(join(backup, 'results'), { recursive: true }); copyFileSync(source, join(backup, 'results', file))
    await repository.save(record)
    if (current.has(record.id)) { await store.remove(record.id); current.delete(record.id) }
    unlinkSync(source); delivered++
  }
  console.log(`Active-game migration complete: imported ${imported} snapshots; delivered ${delivered} legacy results.`)
  if (legacy.length || resultFiles.length) console.log(`Legacy backups: ${backup}`)
} finally { await store.close(); await client.end() }
