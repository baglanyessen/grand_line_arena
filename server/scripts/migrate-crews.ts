import postgres from 'postgres'
import { migrateCrews } from '../src/db/migrateCrews'

const client = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/grand_line_arena',
  { max: 1, connect_timeout: 5, connection: { statement_timeout: 30000 }, onnotice: () => {} })
try { await migrateCrews(client); console.log('Crew membership migration applied.') }
finally { await client.end() }
