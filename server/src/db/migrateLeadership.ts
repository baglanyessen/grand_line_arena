import type { Sql } from 'postgres'
export async function migrateLeadership(client: Sql) {
  await client.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':leadership-v1'))`
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS leadership_challenges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), crew_id uuid NOT NULL REFERENCES crews(id),
      challenger_id uuid NOT NULL REFERENCES users(id), captain_id uuid NOT NULL REFERENCES users(id),
      status text NOT NULL DEFAULT 'pending' CONSTRAINT leadership_status_check CHECK (status IN ('pending','active','completed','declined','cancelled','expired')),
      challenger_score_half integer NOT NULL DEFAULT 0, captain_score_half integer NOT NULL DEFAULT 0,
      winner_id uuid REFERENCES users(id), request_deadline timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
      ended_at timestamp, end_reason text, CONSTRAINT leadership_distinct_players CHECK (challenger_id <> captain_id))`)
    await tx.unsafe("CREATE UNIQUE INDEX IF NOT EXISTS leadership_one_open_per_crew ON leadership_challenges(crew_id) WHERE status IN ('pending','active')")
    await tx.unsafe('CREATE INDEX IF NOT EXISTS leadership_cooldown_idx ON leadership_challenges(challenger_id, created_at)')
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS leadership_matches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), challenge_id uuid NOT NULL REFERENCES leadership_challenges(id),
      round integer NOT NULL CONSTRAINT leadership_round_range CHECK (round BETWEEN 1 AND 3),
      white_id uuid NOT NULL REFERENCES users(id), black_id uuid NOT NULL REFERENCES users(id), game_id uuid UNIQUE REFERENCES games(id),
      result text NOT NULL DEFAULT 'pending' CONSTRAINT leadership_result_check CHECK (result IN ('pending','white','black','draw')),
      join_deadline timestamp NOT NULL, white_ready_at timestamp, black_ready_at timestamp, ended_at timestamp, end_reason text)`)
    await tx.unsafe('CREATE UNIQUE INDEX IF NOT EXISTS leadership_round_unique ON leadership_matches(challenge_id, round)')
  })
}
