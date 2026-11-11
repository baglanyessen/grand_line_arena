import postgres from 'postgres'
import { migrateWarDeadlines } from '../src/db/migrateWarDeadlines'
const client = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/grand_line_arena',
  { max: 1, connect_timeout: 5, connection: { statement_timeout: 30000 }, onnotice: () => {} })
try { await migrateWarDeadlines(client); console.log('War deadline migration applied.') }
finally { await client.end() }
