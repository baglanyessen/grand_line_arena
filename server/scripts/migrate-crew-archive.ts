import postgres from 'postgres'
import { migrateCrewArchive } from '../src/db/migrateCrewArchive'

const client = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/grand_line_arena',
  { max: 1, connect_timeout: 5, connection: { statement_timeout: 30000 }, onnotice: () => {} })
try { await migrateCrewArchive(client); console.log('Crew archive migration applied.') }
finally { await client.end() }
