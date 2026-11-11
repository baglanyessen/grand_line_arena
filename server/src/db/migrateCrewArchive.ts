import type { Sql } from 'postgres'

export async function migrateCrewArchive(client: Sql) {
  await client.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':crew-archive-v1'))`
    await tx.unsafe('ALTER TABLE crews ADD COLUMN IF NOT EXISTS disbanded_at timestamp')
  })
}
