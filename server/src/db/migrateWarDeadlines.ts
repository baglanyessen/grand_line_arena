import type { Sql } from 'postgres'
export async function migrateWarDeadlines(client: Sql) {
  await client.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':war-deadlines-v1'))`
    // Give existing wars a full deployment grace period.
    await tx.unsafe("ALTER TABLE crew_wars ADD COLUMN IF NOT EXISTS request_deadline timestamp NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC') + interval '24 hours')")
    await tx.unsafe('ALTER TABLE crew_wars ADD COLUMN IF NOT EXISTS roster_deadline timestamp')
    await tx.unsafe('ALTER TABLE crew_wars ADD COLUMN IF NOT EXISTS end_reason text')
    await tx.unsafe("UPDATE crew_wars SET roster_deadline = (now() AT TIME ZONE 'UTC') + interval '24 hours' WHERE status = 'active' AND roster_deadline IS NULL")
    await tx.unsafe("ALTER TABLE war_matches ADD COLUMN IF NOT EXISTS join_deadline timestamp NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC') + interval '24 hours')")
    for (const column of ['white_ready_at', 'black_ready_at', 'ended_at']) await tx.unsafe(`ALTER TABLE war_matches ADD COLUMN IF NOT EXISTS ${column} timestamp`)
    await tx.unsafe('ALTER TABLE war_matches ADD COLUMN IF NOT EXISTS end_reason text')
    await tx.unsafe('ALTER TABLE war_settlements DROP CONSTRAINT IF EXISTS war_settlements_status_check')
    await tx.unsafe("ALTER TABLE war_settlements ADD CONSTRAINT war_settlements_status_check CHECK (status IN ('awarded', 'short_games', 'pair_limit', 'forfeit'))")
  })
}
