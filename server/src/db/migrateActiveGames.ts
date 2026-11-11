import type { Sql } from 'postgres'
export async function migrateActiveGames(client: Sql) {
  await client.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':active-games-v1'))`
    await tx.unsafe('CREATE TABLE IF NOT EXISTS active_engine_owner (id boolean PRIMARY KEY DEFAULT true CHECK (id), token uuid NOT NULL)')
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS active_games (
      id uuid PRIMARY KEY, revision integer NOT NULL CHECK (revision > 0), write_token uuid NOT NULL,
      snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS active_game_players (
      user_id uuid PRIMARY KEY REFERENCES users(id), game_id uuid NOT NULL REFERENCES active_games(id) ON DELETE CASCADE)`)
    await tx.unsafe('CREATE INDEX IF NOT EXISTS active_game_players_game_idx ON active_game_players(game_id)')
  })
}
