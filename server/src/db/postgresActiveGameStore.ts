import type { Sql, ReservedSql } from 'postgres'
import { validateStoredGame, type ActiveGameStore, type StoredGame } from '../ws/activeGameStore'

export class ActiveGameConflict extends Error {}
const transient = (error: unknown) => {
  const code = (error as { code?: string }).code ?? ''
  return code.startsWith('08') || ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'CONNECTION_CLOSED', 'CONNECTION_DESTROYED', 'CONNECTION_ENDED', 'CONNECT_TIMEOUT', '57014', '57P01', '40001', '40P01'].includes(code)
}

export class PostgresActiveGameStore implements ActiveGameStore {
  private lease?: ReservedSql
  private token = crypto.randomUUID()
  private revisions = new Map<string, number>()
  constructor(private client: Sql, private retryMs = 500) {}
  get ownerToken() { return this.lease ? this.token : undefined }

  async load() {
    if (this.lease) throw new ActiveGameConflict('The active store is already open')
    this.token = crypto.randomUUID(); this.revisions.clear()
    const lease = await this.client.reserve()
    try {
      const [lock] = await lease`SELECT pg_try_advisory_lock(hashtext(current_schema() || ':chess-active-engine')) AS acquired`
      if (!lock?.acquired) throw new ActiveGameConflict('Another chess engine owns this database; stop it before starting another')
      this.lease = lease
      await this.client`INSERT INTO active_engine_owner (id, token) VALUES (true, ${this.token}) ON CONFLICT (id) DO UPDATE SET token = excluded.token`
      const rows = await this.client`SELECT id, revision, snapshot::text AS snapshot FROM active_games ORDER BY id`
      const games = rows.map(row => {
        const game = validateStoredGame(JSON.parse(row.snapshot))
        if (row.id !== game.id) throw new Error('Active game identity mismatch')
        this.revisions.set(row.id, row.revision)
        return game
      })
      return games
    } catch (error) {
      if (this.lease) { await this.close() } else lease.release()
      throw error
    }
  }

  private async owned(tx: Sql) {
    if (!this.lease) throw new ActiveGameConflict('The active game store has no engine lease')
    const [owner] = await tx`SELECT token FROM active_engine_owner WHERE id = true FOR SHARE`
    if (owner?.token !== this.token) throw new ActiveGameConflict('Chess engine ownership changed; this process is fenced')
  }

  async save(input: StoredGame) {
    const game = validateStoredGame(structuredClone(input)), encoded = JSON.stringify(game)
    const expected = this.revisions.get(game.id) ?? 0, writeToken = crypto.randomUUID()
    // Retry the identical operation token after ambiguous connection loss. Never roll an uncertain commit back in RAM.
    for (;;) {
      try {
        const revision = await this.client.begin(async tx => {
          await this.owned(tx as unknown as Sql)
          const [current] = await tx`SELECT revision, write_token, snapshot->'white'->>'id' AS white_id, snapshot->'black'->>'id' AS black_id, snapshot->>'warMatchId' AS war_match_id, snapshot->>'leadershipMatchId' AS leadership_match_id FROM active_games WHERE id = ${game.id} FOR UPDATE`
          if (current?.write_token === writeToken) return current.revision as number
          if ((current?.revision ?? 0) !== expected) throw new ActiveGameConflict('Stale active game revision')
          if (current && (current.white_id !== game.white.id || current.black_id !== game.black.id || (current.war_match_id ?? undefined) !== game.warMatchId || (current.leadership_match_id ?? undefined) !== game.leadershipMatchId)) throw new ActiveGameConflict('Active game participants or assignment changed')
          if (expected === 0) {
            // Tombstones in completed history prevent resurrecting a game after deletion.
            const [done] = await tx`SELECT id FROM games WHERE id = ${game.id}`
            if (done) throw new ActiveGameConflict('This game has already completed')
            await tx`INSERT INTO active_games (id, revision, write_token, snapshot) VALUES (${game.id}, 1, ${writeToken}, ${tx.typed(encoded, 25)}::jsonb)`
            for (const userId of [game.white.id, game.black.id]) await tx`INSERT INTO active_game_players (user_id, game_id) VALUES (${userId}, ${game.id})`
          } else {
            await tx`UPDATE active_games SET revision = ${expected + 1}, write_token = ${writeToken}, snapshot = ${tx.typed(encoded, 25)}::jsonb, updated_at = now()
              WHERE id = ${game.id} AND revision = ${expected}`
          }
          return expected + 1
        })
        this.revisions.set(game.id, Number(revision)); return
      } catch (error) {
        if (!transient(error)) throw error
        await Bun.sleep(this.retryMs)
      }
    }
  }

  async remove(id: string) {
    const expected = this.revisions.get(id)
    if (expected === undefined) throw new ActiveGameConflict('Unknown active game revision')
    for (;;) {
      try {
        await this.client.begin(async tx => {
          await this.owned(tx as unknown as Sql)
          const [current] = await tx`SELECT revision FROM active_games WHERE id = ${id} FOR UPDATE`
          if (!current) return // Retry after an ambiguous successful deletion.
          if (current.revision !== expected) throw new ActiveGameConflict('Stale active game deletion')
          await tx`DELETE FROM active_games WHERE id = ${id} AND revision = ${expected}`
        })
        this.revisions.delete(id); return
      } catch (error) { if (!transient(error)) throw error; await Bun.sleep(this.retryMs) }
    }
  }

  async close() {
    const lease = this.lease; this.lease = undefined
    if (lease) {
      try { await lease`SELECT pg_advisory_unlock(hashtext(current_schema() || ':chess-active-engine'))` }
      finally { lease.release() }
    }
  }
}
