import type { Sql } from 'postgres'

export async function migrateWarRosters(client: Sql) {
  await client.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':war-rosters-v1'))`
    await tx.unsafe('ALTER TABLE war_matches ADD COLUMN IF NOT EXISTS board_number integer')
    await tx.unsafe(`WITH numbered AS (SELECT id, row_number() OVER (PARTITION BY war_id ORDER BY id)::int AS number FROM war_matches)
      UPDATE war_matches m SET board_number = n.number FROM numbered n WHERE m.id = n.id AND m.board_number IS NULL`)
    await tx.unsafe('ALTER TABLE war_matches ALTER COLUMN board_number SET NOT NULL')
    await tx.unsafe('CREATE UNIQUE INDEX IF NOT EXISTS war_matches_board_unique ON war_matches (war_id, board_number)')
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS war_fighters (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), war_id uuid NOT NULL REFERENCES crew_wars(id),
      crew_id uuid NOT NULL REFERENCES crews(id), user_id uuid NOT NULL REFERENCES users(id),
      position integer NOT NULL CONSTRAINT war_fighters_position_range CHECK (position BETWEEN 0 AND 14))`)
    await tx.unsafe('CREATE UNIQUE INDEX IF NOT EXISTS war_fighters_user_unique ON war_fighters (war_id, user_id)')
    await tx.unsafe('CREATE UNIQUE INDEX IF NOT EXISTS war_fighters_position_unique ON war_fighters (war_id, crew_id, position)')
  })
}
