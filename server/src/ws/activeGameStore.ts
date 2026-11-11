import { Chess } from 'chess.js'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCompletedGame, type CompletedGame } from '../db/gameRepository'

export interface StoredPlayer { id: string; username: string; rating: number; bounty?: number; bountyVersion?: number; connected: boolean; reconnectUntil: number | null }
export interface StoredGame {
  version: 1; id: string; warMatchId?: string; leadershipMatchId?: string; pgn: string; fen: string; startedAt: number; savedAt: number
  white: StoredPlayer; black: StoredPlayer; drawOfferedBy: string | null; acceptedRequests: string[]
  clock: { whiteMs: number; blackMs: number; initialMs: number; running: 'w' | 'b' | null; revision: number }
  finalization?: { record: CompletedGame; reason: string }
}
export interface ActiveGameStore {
  readonly ownerToken?: string
  load(): StoredGame[] | Promise<StoredGame[]>
  save(game: StoredGame): void | Promise<void>
  remove(id: string): void | Promise<void>
  close?(): Promise<void>
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateStoredGame(value: unknown): StoredGame {
  if (!value || typeof value !== 'object') throw new Error('Invalid active game')
  const row = value as StoredGame
  if (row.version !== 1 || (row.leadershipMatchId !== undefined && (row.leadershipMatchId !== row.id || row.warMatchId !== undefined)) || !uuid.test(row.id) || (row.warMatchId !== undefined && row.warMatchId !== row.id) ||
      typeof row.pgn !== 'string' || row.pgn.length > 1_000_000 || typeof row.fen !== 'string' ||
      !Number.isSafeInteger(row.startedAt) || !Number.isSafeInteger(row.savedAt) || row.startedAt > row.savedAt || row.startedAt < 0 ||
      !Array.isArray(row.acceptedRequests) || row.acceptedRequests.length > 20000) throw new Error('Invalid active game record')
  for (const player of [row.white, row.black]) {
    if (!player || !uuid.test(player.id) || typeof player.username !== 'string' || player.username.length > 200 ||
        !Number.isFinite(player.rating) || typeof player.connected !== 'boolean' ||
        (player.reconnectUntil !== null && (!Number.isSafeInteger(player.reconnectUntil) || player.reconnectUntil < 0))) throw new Error('Invalid active player')
  }
  if (!row.finalization && [row.white, row.black].some(player => !player.connected && player.reconnectUntil === null)) throw new Error('Missing reconnect deadline')
  if (row.white.id === row.black.id || (row.drawOfferedBy !== null && ![row.white.id, row.black.id].includes(row.drawOfferedBy)) ||
      row.acceptedRequests.some(key => typeof key !== 'string' || key.length > 120 || ![row.white.id, row.black.id].some(id => key.startsWith(`${id}:`)))) throw new Error('Invalid active game participants/history')
  const clock = row.clock
  if (!clock || !Number.isSafeInteger(clock.initialMs) || clock.initialMs < 1 || clock.initialMs > 86400000 ||
      !Number.isSafeInteger(clock.revision) || clock.revision < 0 || ![null, 'w', 'b'].includes(clock.running) ||
      [clock.whiteMs, clock.blackMs].some(ms => !Number.isFinite(ms) || ms < 0 || ms > clock.initialMs)) throw new Error('Invalid active clock')
  const chess = new Chess(); chess.loadPgn(row.pgn)
  if (chess.fen() !== row.fen || (!row.finalization && (clock.running !== chess.turn() || chess.isGameOver()))) throw new Error('Inconsistent active position')
  if (row.finalization) {
    const record = validateCompletedGame(row.finalization.record)
    if (clock.running !== null || record.id !== row.id || record.whiteId !== row.white.id || record.blackId !== row.black.id ||
        record.pgn !== row.pgn || record.warMatchId !== row.warMatchId || record.leadershipMatchId !== row.leadershipMatchId || new Date(record.startedAt).getTime() !== row.startedAt ||
        typeof row.finalization.reason !== 'string' || row.finalization.reason.length > 100) throw new Error('Invalid active finalization')
    row.finalization.record = record
  }
  return row
}

export class FileActiveGameStore implements ActiveGameStore {
  readonly directory: string
  constructor(directory = process.env.ACTIVE_GAMES_DIR ?? fileURLToPath(new URL('../../.data/active-games/', import.meta.url))) { this.directory = resolve(directory) }
  private path(id: string) { if (!uuid.test(id)) throw new Error('Invalid active game ID'); return join(this.directory, `${id}.json`) }
  load() {
    mkdirSync(this.directory, { recursive: true })
    return readdirSync(this.directory).filter(name => name.endsWith('.json')).map(name => {
      const record = validateStoredGame(JSON.parse(readFileSync(join(this.directory, name), 'utf8')))
      if (name !== `${record.id}.json`) throw new Error('Active game filename mismatch')
      return record
    })
  }
  save(input: StoredGame) {
    const record = validateStoredGame(input), destination = this.path(record.id)
    mkdirSync(this.directory, { recursive: true })
    const temporary = join(this.directory, `${record.id}.${crypto.randomUUID()}.tmp`)
    const fd = openSync(temporary, 'wx')
    try { writeFileSync(fd, JSON.stringify(record), 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
    try { renameSync(temporary, destination) }
    catch (error) { try { unlinkSync(temporary) } catch {} throw error }
  }
  remove(id: string) { try { unlinkSync(this.path(id)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
}
