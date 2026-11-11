import postgres from 'postgres'
import { writeFileSync } from 'node:fs'
import { createChessWs } from '../chess'
import { PostgresActiveGameStore } from '../../db/postgresActiveGameStore'

const client = postgres(process.env.RECOVERY_PG_URL!, { max: 5, connect_timeout: 5,
  connection: { search_path: process.env.RECOVERY_PG_SCHEMA!, statement_timeout: 5000 } })
const players = JSON.parse(process.env.RECOVERY_PG_PLAYERS!) as { id: string; username: string; rating: number }[]
const app = createChessWs({ activeStore: new PostgresActiveGameStore(client), initialTimeMs: 60000,
  findPlayer: async id => players.find(player => player.id === id) ?? null })
  .listen({ hostname: '127.0.0.1', port: 0 })
await app.decorator.gameStorageReady
writeFileSync(process.env.RECOVERY_PG_READY!, JSON.stringify({ port: app.server!.port }))
