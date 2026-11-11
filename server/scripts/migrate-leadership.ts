import postgres from 'postgres'
import { migrateLeadership } from '../src/db/migrateLeadership'
const client = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/grand_line_arena',
  { max: 1, connect_timeout: 5, connection: { statement_timeout: 30000 }, onnotice: () => {} })
try { await migrateLeadership(client); console.log('Leadership challenge migration applied.') }
finally { await client.end() }
