import postgres from 'postgres'
import { migrateWarRosters } from '../src/db/migrateWarRosters'
const client = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/grand_line_arena',
  { max: 1, connect_timeout: 5, connection: { statement_timeout: 30000 }, onnotice: () => {} })
try { await migrateWarRosters(client); console.log('War roster migration applied.') }
finally { await client.end() }
