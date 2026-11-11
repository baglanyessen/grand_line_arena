import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCompletedGame, type CompletedGame } from './gameRepository'

export interface ResultSink {
  start(): void
  enqueue(record: CompletedGame): void | Promise<void>
  stop(): Promise<void>
}

export class ResultOutbox implements ResultSink {
  private pending = new Map<string, CompletedGame>()
  private running: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  private started = false
  readonly directory: string

  constructor(private options: {
    write: (record: CompletedGame) => Promise<void>
    directory?: string
    onSaved?: (record: CompletedGame) => void | Promise<void>
    retryMs?: number
  }) {
    this.directory = resolve(options.directory ?? process.env.GAME_RESULTS_DIR ?? fileURLToPath(new URL('../../.data/game-results/', import.meta.url)))
  }

  start() {
    if (this.started) return
    mkdirSync(this.directory, { recursive: true })
    for (const file of readdirSync(this.directory).filter(name => name.endsWith('.json'))) {
      const record = validateCompletedGame(JSON.parse(readFileSync(join(this.directory, file), 'utf8')))
      if (file !== `${record.id}.json`) throw new Error('Result journal filename does not match its game ID')
      this.pending.set(record.id, record)
    }
    this.started = true
    this.timer = setInterval(() => void this.flush(), this.options.retryMs ?? 5000)
    this.timer.unref()
    void this.flush()
  }

  enqueue(input: CompletedGame) {
    const record = validateCompletedGame(input)
    mkdirSync(this.directory, { recursive: true })
    const destination = join(this.directory, `${record.id}.json`)
    const encoded = JSON.stringify(record)
    if (existsSync(destination)) {
      if (JSON.stringify(validateCompletedGame(JSON.parse(readFileSync(destination, 'utf8')))) !== encoded)
        throw new Error('Conflicting result already exists in the journal')
    } else {
      const temporary = join(this.directory, `${record.id}.${crypto.randomUUID()}.tmp`)
      const fd = openSync(temporary, 'wx')
      try { writeFileSync(fd, encoded, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temporary, destination)
    }
    this.pending.set(record.id, record)
    if (this.started) void this.flush()
  }

  flush(): Promise<void> {
    if (this.running) return this.running
    this.running = this.drain().finally(() => { this.running = null })
    return this.running
  }

  hasPending(gameId: string) { return this.pending.has(gameId) }

  private async drain() {
    for (const record of [...this.pending.values()]) {
      try {
        await this.options.write(record)
        try { unlinkSync(join(this.directory, `${record.id}.json`)) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        this.pending.delete(record.id)
      } catch {
        console.error(`[RESULT] Game ${record.id} is still queued; database/journal delivery will be retried`)
        continue
      }
      try { await this.options.onSaved?.(record) }
      catch { console.error(`[RESULT] Game ${record.id} was saved but its notification failed`) }
    }
  }

  async stop() {
    this.started = false
    clearInterval(this.timer)
    await this.flush()
  }
}
