import postgres from 'postgres'
import { migrateWarSettlement } from '../src/db/migrateWarSettlement'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import * as schema from '../src/db/schema'
import { createGameRepository } from '../src/db/gameRepository'
const client = postgres(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/grand_line_arena',
  { max: 1, connect_timeout: 5, connection: { statement_timeout: 30000 }, onnotice: () => {} })
try {
  await migrateWarSettlement(client)
  const database = drizzle(client, { schema }), repository = createGameRepository(database)
  const saved = await database.select({ game: schema.games, warId: schema.warMatches.warId, matchId: schema.warMatches.id })
    .from(schema.games).innerJoin(schema.warMatches, eq(schema.warMatches.gameId, schema.games.id))
    .innerJoin(schema.crewWars, eq(schema.crewWars.id, schema.warMatches.warId)).where(eq(schema.crewWars.status, 'active'))
  const processed = new Set<string>()
  for (const row of saved) {
    if (processed.has(row.warId) || !row.game.endedAt || row.game.result === 'ongoing') continue
    await repository.save({ id: row.game.id, whiteId: row.game.whiteId, blackId: row.game.blackId, warMatchId: row.matchId,
      pgn: row.game.pgn, result: row.game.result, startedAt: row.game.startedAt.toISOString(), endedAt: row.game.endedAt.toISOString() })
    processed.add(row.warId)
  }
  console.log(`War settlement migration applied; reconciled ${processed.size} active wars with saved results.`)
}
finally { await client.end() }
