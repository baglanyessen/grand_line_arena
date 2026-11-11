import type { Sql } from 'postgres'

export async function migrateWarSettlement(client: Sql) {
  await client.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':war-settlement-v1'))`
    await tx.unsafe('ALTER TABLE crew_wars ADD COLUMN IF NOT EXISTS challenger_score_half integer NOT NULL DEFAULT 0')
    await tx.unsafe('ALTER TABLE crew_wars ADD COLUMN IF NOT EXISTS defender_score_half integer NOT NULL DEFAULT 0')
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS war_settlements (
      war_id uuid PRIMARY KEY REFERENCES crew_wars(id), status text NOT NULL CHECK (status IN ('awarded', 'short_games', 'pair_limit')),
      policy_version integer NOT NULL, settled_at timestamp NOT NULL DEFAULT now())`)
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS war_rewards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), war_id uuid NOT NULL REFERENCES war_settlements(war_id),
      user_id uuid NOT NULL REFERENCES users(id), crew_id uuid NOT NULL REFERENCES crews(id),
      delta integer NOT NULL CHECK (delta BETWEEN 0 AND 200), bounty_after bigint NOT NULL CHECK (bounty_after BETWEEN 0 AND 1000000000000))`)
    await tx.unsafe('CREATE UNIQUE INDEX IF NOT EXISTS war_rewards_player_unique ON war_rewards (war_id, user_id)')
  })
}
