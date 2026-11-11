import { Elysia } from 'elysia'
import { createWarDeadlineProcessor } from '../db/warDeadlines'
import { createLeadershipDeadlineProcessor } from '../db/leadershipDeadlines'

export function createWarDeadlineWorker(protectedMatch: (id: string) => boolean, refreshWaiting: () => Promise<void>, storageReady: Promise<void> = Promise.resolve(), ownerToken: () => string | undefined = () => undefined) {
  const processor = createWarDeadlineProcessor()
  const leadership = createLeadershipDeadlineProcessor()
  let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | null = null
  const run = () => {
    if (!running) running = storageReady.then(() => processor.sweep(new Date(), protectedMatch, ownerToken()))
      .then(() => leadership.sweep(new Date(), protectedMatch, ownerToken()))
      .then(refreshWaiting)
      .catch(() => { console.error('[WAR] Deadline processing failed; retrying on the next tick') })
      .finally(() => { running = null })
    return running
  }
  return new Elysia().onStart(() => { void run(); timer = setInterval(() => void run(), 30000); timer.unref() })
    .onStop(async () => { clearInterval(timer); await running })
}
