import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/grand_line_arena'

export const client = postgres(DATABASE_URL, { connect_timeout: 5, connection: { statement_timeout: 5000 } })
export const db = drizzle(client, { schema })
