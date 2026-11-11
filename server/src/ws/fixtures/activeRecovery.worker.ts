import { join } from 'node:path'
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { createChessWs } from '../chess'
import { FileActiveGameStore } from '../activeGameStore'
import { ResultOutbox } from '../../db/resultOutbox'

const root = process.env.RECOVERY_TEST_DIR!
const players = JSON.parse(process.env.RECOVERY_TEST_PLAYERS!) as { id: string; username: string; rating: number }[]
mkdirSync(join(root, 'completed'), { recursive: true })
const app = createChessWs({ findPlayer: async id => players.find(player => player.id === id) ?? null,
  getWarMatch: process.env.RECOVERY_TEST_WAR ? async () => ({ id: process.env.RECOVERY_TEST_WAR!, whiteId: players[0]!.id, blackId: players[1]!.id }) : undefined,
  getLeadershipMatch: process.env.RECOVERY_TEST_LEADERSHIP ? async () => ({ id: process.env.RECOVERY_TEST_LEADERSHIP!, whiteId: players[0]!.id, blackId: players[1]!.id }) : undefined,
  activeStore: new FileActiveGameStore(join(root, 'active')), initialTimeMs: Number(process.env.RECOVERY_TEST_CLOCK ?? 60000),
  resultSink: new ResultOutbox({ directory: join(root, 'results'), write: async record => {
    const file = join(root, 'completed', `${record.id}.json`), encoded = JSON.stringify(record)
    if (existsSync(file)) { if (readFileSync(file, 'utf8') !== encoded) throw new Error('Conflicting completed record'); return }
    writeFileSync(file, encoded, { flag: 'wx' })
  } }) }).listen({ hostname: '127.0.0.1', port: 0 })
writeFileSync(process.env.RECOVERY_TEST_READY!, JSON.stringify({ port: app.server!.port }))
