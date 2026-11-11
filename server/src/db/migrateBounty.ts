import type { Sql } from 'postgres'

export async function migrateBounty(client: Sql) {
  await client.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':bounty-v1'))`
    await tx.unsafe('ALTER TABLE users ALTER COLUMN bounty TYPE bigint USING bounty::bigint')
    await tx.unsafe('ALTER TABLE users ADD COLUMN IF NOT EXISTS bounty_version integer NOT NULL DEFAULT 0')
    await tx.unsafe('ALTER TABLE crews ALTER COLUMN total_bounty TYPE bigint USING total_bounty::bigint')
    await tx.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = 'users_bounty_range') THEN
        ALTER TABLE users ADD CONSTRAINT users_bounty_range CHECK (bounty BETWEEN 0 AND 1000000000000);
      END IF;
    END $$`)
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS game_rewards (
      game_id uuid PRIMARY KEY REFERENCES games(id),
      white_delta integer NOT NULL, black_delta integer NOT NULL,
      white_after bigint NOT NULL CHECK (white_after BETWEEN 0 AND 1000000000000),
      black_after bigint NOT NULL CHECK (black_after BETWEEN 0 AND 1000000000000),
      status text NOT NULL CHECK (status IN ('awarded', 'draw', 'short_game', 'pair_limit')),
      policy_version integer NOT NULL, settled_at timestamp NOT NULL DEFAULT now()
    )`)
  })
}
