import type { Sql } from 'postgres'

export async function migrateCrews(client: Sql) {
  await client.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':crew-membership-v1'))`
    await tx.unsafe('LOCK TABLE crews, crew_members IN SHARE ROW EXCLUSIVE MODE')
    await tx.unsafe('ALTER TABLE crews ADD COLUMN IF NOT EXISTS disbanded_at timestamp')
    const [invalid] = await tx`SELECT
      EXISTS (SELECT user_id FROM crew_members GROUP BY user_id HAVING count(*) > 1) AS duplicates,
      EXISTS (SELECT 1 FROM crews c WHERE c.max_members < 1 OR
        (SELECT count(*) FROM crew_members m WHERE m.crew_id = c.id) > c.max_members) AS capacity,
      EXISTS (SELECT 1 FROM crews c WHERE c.disbanded_at IS NULL AND NOT EXISTS (SELECT 1 FROM crew_members m
        WHERE m.crew_id = c.id AND m.user_id = c.captain_id AND m.role = 'captain')) OR
      EXISTS (SELECT 1 FROM crew_members m JOIN crews c ON c.id = m.crew_id
        WHERE m.role = 'captain' AND m.user_id <> c.captain_id) AS captains`
    if (invalid?.duplicates || invalid?.capacity || invalid?.captains)
      throw new Error('Crew migration blocked: existing duplicate memberships, invalid capacity or inconsistent captains require repair; no rows were changed')
    await tx.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'crew_members'::regclass AND conname = 'crew_members_user_unique') THEN
        ALTER TABLE crew_members ADD CONSTRAINT crew_members_user_unique UNIQUE (user_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'crews'::regclass AND conname = 'crews_positive_capacity') THEN
        ALTER TABLE crews ADD CONSTRAINT crews_positive_capacity CHECK (max_members > 0);
      END IF;
    END $$`)
    await tx.unsafe("CREATE UNIQUE INDEX IF NOT EXISTS crew_members_one_captain ON crew_members (crew_id) WHERE role = 'captain'")
    await tx.unsafe('CREATE INDEX IF NOT EXISTS crew_members_crew_idx ON crew_members (crew_id)')
  })
}
