import { leadershipRepository } from '../db/leadershipRepository'
import { PostgresActiveGameStore, ActiveGameConflict } from '../db/postgresActiveGameStore'
import { type ActiveGameStore, type StoredGame } from './activeGameStore'
import { warRepository } from '../db/warRepository'
import { CrewError } from '../db/crewRepository'
import { Elysia } from 'elysia'
import { Chess } from 'chess.js'
import { applyMoveRequest, snapshotGame, type GameState } from './gameState'
import { createClock, clockRemaining, clockSnapshot, expiredColor, stopClock, switchClock, timeoutOutcome, DEFAULT_TIME_MS } from './clock'
import { eq } from 'drizzle-orm'
import { authJwt } from '../auth/jwt'
import { db, client } from '../db'
import { users } from '../db/schema'
import { gameRepository, type CompletedGame } from '../db/gameRepository'
import { ResultOutbox, type ResultSink } from '../db/resultOutbox'

export interface AuthenticatedPlayer { id: string; username: string; rating: number; bounty?: number; bountyVersion?: number }

async function findPlayer(id: string): Promise<AuthenticatedPlayer | null> {
  const [player] = await db.select({ id: users.id, username: users.username, rating: users.rating, bounty: users.bounty, bountyVersion: users.bountyVersion })
    .from(users).where(eq(users.id, id)).limit(1)
  return player ?? null
}

/**
 * In-memory store for active games and matchmaking queue.
 * In production, consider Redis for multi-instance support.
 */
interface GamePlayer {
  id: string
  username: string
  rating: number
  bounty?: number
  bountyVersion?: number
  ws: any
  contestKind?: 'war' | 'leadership'
  warReadyAt?: string
  reconnectBy?: number
  reconnectTimer?: ReturnType<typeof setTimeout>
}
interface ActiveGame extends GameState {
  warMatchId?: string
  leadershipMatchId?: string
  white: GamePlayer
  black: GamePlayer
  startedAt: number
  deadline?: ReturnType<typeof setTimeout>
  heartbeat?: ReturnType<typeof setInterval>
  finalization?: { record: CompletedGame; final: Record<string, any>; moveMessage?: string }
  finalizationRetry?: ReturnType<typeof setTimeout>
  storageRetry?: ReturnType<typeof setTimeout>
}

export function createChessWs(options: {
  findPlayer?: (id: string) => Promise<AuthenticatedPlayer | null>
  authTimeoutMs?: number
  initialTimeMs?: number
  now?: () => number
  wallNow?: () => number
  activeStore?: ActiveGameStore
  reconnectGraceMs?: number
  getWarMatch?: (actorId: string, matchId: string) => Promise<{ id: string; whiteId: string; blackId: string; readyAt?: string; joinDeadline?: string }>
  getLeadershipMatch?: (actorId: string, matchId: string) => Promise<{ id: string; whiteId: string; blackId: string; readyAt?: string; joinDeadline?: string }>
  clearWarReady?: (actorId: string, matchId: string, readyAt: string) => Promise<void>
  resultSink?: ResultSink
} = {}) {
  const lookupPlayer = options.findPlayer ?? findPlayer
  const activeStore = options.activeStore ?? new PostgresActiveGameStore(client)
  const wallNow = options.wallNow ?? (() => Date.now())
  const now = options.now ?? (() => performance.now())
  const initialTimeMs = options.initialTimeMs ?? DEFAULT_TIME_MS
  const reconnectGraceMs = options.reconnectGraceMs ?? 30_000
  if (!Number.isSafeInteger(reconnectGraceMs) || reconnectGraceMs < 1 || reconnectGraceMs > 300_000)
    throw new Error('Reconnect grace must be between 1 ms and 5 minutes')
  createClock(initialTimeMs, now()) // Validate server configuration before accepting connections.
  const sessions = new Map<string, {
    authenticating: boolean
    player?: AuthenticatedPlayer
    expiresAt?: number
    timeout: ReturnType<typeof setTimeout>
    ws: any
  }>()
  const playerConnections = new Map<string, string>()
  const matchmakingQueue: (AuthenticatedPlayer & { ws: any })[] = []
  const activeGames = new Map<string, ActiveGame>()
  const playerGameMap = new Map<string, string>() // playerId -> gameId
  const warWaiting = new Map<string, Map<string, GamePlayer>>()
  const warLookupPending = new Set<string>()
  const warLookupCancelled = new Set<string>()
  const finishedWarMatches = new Set<string>()
  const lookupWarMatch = options.getWarMatch ?? ((actorId, matchId) => warRepository.checkInForPlayer(actorId, matchId))
  const lookupLeadershipMatch = options.getLeadershipMatch ?? ((actorId, matchId) => leadershipRepository.checkInForPlayer(actorId, matchId))
  const clearWarReady = options.clearWarReady ?? ((actorId, matchId, readyAt) => warRepository.clearReady(actorId, matchId, readyAt))
  function clearReady(player: GamePlayer | undefined, matchId: string) {
    if (player?.warReadyAt) void (player.contestKind === 'leadership' ? leadershipRepository.clearReady(player.id, matchId, player.warReadyAt) : clearWarReady(player.id, matchId, player.warReadyAt)).catch(() => console.error('[WAR] Unable to clear waiting-room attendance'))
  }
  const results = new Map<string, { gameId: string; message: Record<string, any>; expiresAt: number }>()
  async function notifySaved(record: CompletedGame) {
    if (record.warMatchId || record.leadershipMatchId) finishedWarMatches.delete(record.warMatchId ?? record.leadershipMatchId!)
    const bountyReward = await gameRepository.settlement(record.id)
    const warSettlement = record.warMatchId ? await gameRepository.warSettlementForGame(record.id) : null
    const recipients = [...new Set([record.whiteId, record.blackId, ...(warSettlement?.rewards.map(reward => reward.userId) ?? [])])]
    const profiles = await gameRepository.playerBounties(recipients)
    for (const userId of recipients) {
      const receipt = results.get(userId)
      if (receipt?.gameId === record.id) Object.assign(receipt.message, { persistence: 'saved', bountyReward, warSettlement })
      if (receipt && warSettlement?.settlement && warSettlement.matchIds.includes(receipt.gameId)) receipt.message.warSettlement = warSettlement
      const connection = playerConnections.get(userId)
      const session = connection ? sessions.get(connection) : undefined
      const profile = profiles.find(profile => profile.id === userId)
      if (session?.player && profile) Object.assign(session.player, profile)
      const queued = matchmakingQueue.find(player => player.id === userId)
      if (queued && profile) Object.assign(queued, profile)
      if (connection) safeSend(sessions.get(connection)?.ws, JSON.stringify({ type: [record.whiteId, record.blackId].includes(userId) ? 'game_saved' : 'war_settled', gameId: record.id, bountyReward, profiles, warSettlement }))
    }
  }
  const resultSink: ResultSink = options.resultSink ?? { start() {}, enqueue: record => gameRepository.save(record), async stop() {} }
  const operations = new Map<string, Promise<unknown>>()
  let stopping = false, fenced = false, storageReady = false
  function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const prior = operations.get(key) ?? Promise.resolve()
    const next = prior.catch(() => {}).then(action)
    operations.set(key, next)
    void next.finally(() => { if (operations.get(key) === next) operations.delete(key) }).catch(() => {})
    return next
  }
  let readyResolve!: () => void, readyReject!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  void ready.catch(() => {})


  function pruneResults() {
    for (const [id, result] of results) if (result.expiresAt <= now()) results.delete(id)
    while (results.size > 2000) results.delete(results.keys().next().value!)
  }

  function generateId() {
    return crypto.randomUUID()
  }

  function rejectConnection(ws: any, code: string, message: string, closeCode = 1008) {
    ws.send(JSON.stringify({ type: 'error', code, message }))
    ws.close(closeCode, message)
  }

  return new Elysia()
    .decorate('gameStorageReady', ready)
    .decorate('isGameStorageReady', () => storageReady && !stopping && !fenced)
    .decorate('gameStorageOwner', () => activeStore.ownerToken)
    .decorate('isWarMatchProtected', (id: string) => activeGames.has(id) || finishedWarMatches.has(id) || (resultSink instanceof ResultOutbox && resultSink.hasPending(id)))
    .decorate('refreshWarWaiting', async () => {
      for (const [id, room] of [...warWaiting]) {
        const first = room.values().next().value
        if (!first) continue
        try { if (first.contestKind === 'leadership') await leadershipRepository.inspect(first.id, id); else await warRepository.matchForPlayer(first.id, id) }
        catch (error) {
          if (!(error instanceof CrewError) || warWaiting.get(id) !== room) continue
          for (const player of [...room.values()]) {
            leaveWarWaiting(player.id, false)
            rejectWarEntry(player.ws, player.id, 'War entry is closed. Refresh your crew war history for the result.')
          }
        }
      }
    })
    .onStart(async () => {
      try {
      const stored = await activeStore.load(), participants = new Set<string>()
      for (const row of stored) for (const player of [row.white, row.black]) {
        if (participants.has(player.id)) throw new Error('An account appears in multiple stored active games')
        participants.add(player.id)
      }
      for (const row of stored) await restoreStoredGame(row)
      resultSink.start()
      storageReady = true; readyResolve()
      } catch (error) { readyReject(error); await activeStore.close?.(); throw error }
    })
    .onStop(async () => {
      stopping = true
      for (const game of activeGames.values()) {
        clearInterval(game.heartbeat); clearTimeout(game.deadline); clearTimeout(game.finalizationRetry); clearTimeout(game.storageRetry)
        clearTimeout(game.white.reconnectTimer); clearTimeout(game.black.reconnectTimer)
      }
      await Promise.allSettled([...operations.values()])
      for (const game of activeGames.values()) {
        if (game.finalization) {
          await journalFinalResult(game)
          if (activeGames.has(game.id)) throw new Error('Cannot stop with an unjournaled result; restore writable result storage first')
        } else { if (!fenced) await persistActive(game); cleanupGame(game.id) }
      }
      for (const session of sessions.values()) clearTimeout(session.timeout)
      sessions.clear()
      playerConnections.clear()
      matchmakingQueue.length = 0
      warWaiting.clear(); warLookupPending.clear(); finishedWarMatches.clear()
      results.clear()
      await resultSink.stop()
      await activeStore.close?.()
    })
    .ws('/ws/chess', {
      maxPayloadLength: 16 * 1024,
      open(ws) {
        const timeout = setTimeout(() => {
          if (sessions.has(ws.id)) rejectConnection(ws, 'authentication_timeout', 'Authentication timed out')
        }, options.authTimeoutMs ?? 10_000)
        sessions.set(ws.id, { authenticating: false, timeout, ws })
      },

      async message(ws, rawMessage) {
        try { await ready } catch { rejectConnection(ws, 'storage_unavailable', 'Game storage is unavailable', 1011); return }
        if (stopping || fenced) { rejectConnection(ws, 'storage_unavailable', 'Chess engine is restarting', 1011); return }
        const session = sessions.get(ws.id)
        if (!session) return
        let data: any
        try {
          data = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage
        } catch {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
          return
        }

        if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string') {
          ws.send(JSON.stringify({ type: 'error', code: 'invalid_message', message: 'Invalid message' }))
          return
        }
        const { type } = data

        if (type === 'authenticate') {
          if (session.player || session.authenticating) {
            ws.send(JSON.stringify({ type: 'error', code: 'already_authenticating', message: 'Authentication has already started' }))
            return
          }
          session.authenticating = true
          const payload = typeof data.token === 'string' && data.token.length <= 8192
            ? await authJwt.decorator.jwt.verify(data.token, { algorithms: ['HS256'], requiredClaims: ['sub', 'exp'] })
            : false
          if (!payload || typeof payload.sub !== 'string' ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub) ||
              typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
            if (sessions.get(ws.id) === session && ws.readyState === 1)
              rejectConnection(ws, 'authentication_failed', 'Invalid or expired login token')
            return
          }
          let player
          try { player = await lookupPlayer(payload.sub) }
          catch {
            if (sessions.get(ws.id) === session && ws.readyState === 1)
              rejectConnection(ws, 'authentication_unavailable', 'Unable to authenticate. Try again later.', 1011)
            return
          }
          // An asynchronous lookup must not revive a timed-out or disconnected socket.
          if (sessions.get(ws.id) !== session || ws.readyState !== 1) return
          if (!player || player.id !== payload.sub || payload.exp * 1000 <= Date.now()) {
            rejectConnection(ws, 'authentication_failed', 'Invalid or expired login token')
            return
          }
          const oldId = playerConnections.get(player.id)
          if (oldId && sessions.get(oldId)?.ws.readyState === 1) {
            rejectConnection(ws, 'duplicate_connection', 'This account is already connected in another tab')
            return
          }
          clearTimeout(session.timeout)
          session.player = player
          session.expiresAt = payload.exp * 1000
          playerConnections.set(player.id, ws.id)
          ws.send(JSON.stringify({ type: 'authenticated', user: player }))
          await serial(`game:${playerGameMap.get(player.id) ?? player.id}`, () => restoreSession(ws, player))
          return
        }

        if (!session.player) {
          if (session.authenticating)
            ws.send(JSON.stringify({ type: 'error', code: 'authentication_pending', message: 'Wait for authentication to finish' }))
          else rejectConnection(ws, 'authentication_required', 'Authenticate before playing')
          return
        }
        if (!session.expiresAt || Date.now() >= session.expiresAt) {
          rejectConnection(ws, 'authentication_expired', 'Login expired. Sign in again.')
          return
        }

        if (type === 'leave_war_match') {
          if (warLookupPending.has(ws.id)) warLookupCancelled.add(ws.id)
          leaveWarWaiting(session.player.id); safeSend(ws, JSON.stringify({ type: 'war_left' })); return
        }
        if (['join_war_match', 'join_leadership_match'].includes(type) && !playerGameMap.has(session.player.id)) { await handleJoinWar(ws, session.player, data.matchId, type === 'join_leadership_match' ? 'leadership' : 'war'); return }
        const commandKey = playerGameMap.get(session.player.id)
        await serial(commandKey ? `game:${commandKey}` : 'matchmaking', async () => {
          if (sessions.get(ws.id) !== session || ws.readyState !== 1 || stopping || fenced) return
        const activeId = playerGameMap.get(session.player!.id)
        const active = activeId ? activeGames.get(activeId) : undefined
        if (active?.finalization) { sendFinalizing(active, ws); return }
        if (active && (await finishIfExpired(active, now()) || await finishIfAbsent(active, now()))) return

        switch (type) {
          case 'join_war_match':
          case 'join_leadership_match':
            await handleJoinWar(ws, session.player!, data.matchId, type === 'join_leadership_match' ? 'leadership' : 'war')
            break
          case 'leave_war_match':
            if (warLookupPending.has(ws.id)) warLookupCancelled.add(ws.id)
            leaveWarWaiting(session.player!.id)
            ws.send(JSON.stringify({ type: 'war_left' }))
            break
          case 'ack_result':
            if (results.get(session.player!.id)?.gameId === data.gameId) results.delete(session.player!.id)
            break
          case 'join_queue':
            await handleJoinQueue(ws, session.player!)
            break
          case 'leave_queue':
            handleLeaveQueue(ws, session.player!)
            break
          case 'move':
            await handleMove(ws, data, session.player!)
            break
          case 'sync_game':
            handleSync(ws, data, session.player!)
            break
          case 'draw_decline':
            await handleDrawDecline(ws, data, session.player!)
            break
          case 'resign':
            await handleResign(ws, data, session.player!)
            break
          case 'draw_offer':
            await handleDrawOffer(ws, data, session.player!)
            break
          case 'draw_accept':
            await handleDrawAccept(ws, data, session.player!)
            break
          default:
            ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${type}` }))
        }
        })
      },

      async close(ws) {
        const session = sessions.get(ws.id)
        if (session) {
          clearTimeout(session.timeout)
          if (session.player && playerConnections.get(session.player.id) === ws.id)
            playerConnections.delete(session.player.id)
          if (session.player) leaveWarWaiting(session.player.id)
          sessions.delete(ws.id)
        }
        // Remove from queue if in queue
        const idx = matchmakingQueue.findIndex((p) => p.ws.id === ws.id)
        if (idx !== -1) matchmakingQueue.splice(idx, 1)

        if (stopping) return
        // Clean up any active game where this socket was playing
        for (const game of activeGames.values()) {
          if (game.white.ws?.id === ws.id || game.black.ws?.id === ws.id) {
            await serial(`game:${game.id}`, async () => {
            if (fenced || !activeGames.has(game.id)) return
            if (game.finalization) {
              const participant = game.white.ws?.id === ws.id ? game.white : game.black
              participant.ws = null
              return
            }
            if (await finishIfExpired(game, now())) return
            const participant = game.white.ws?.id === ws.id ? game.white : game.black
            participant.ws = null
            participant.reconnectBy = now() + reconnectGraceMs
            scheduleReconnectDeadline(game, participant)
            await persistOrRetry(game)
            broadcastState(game)
            })
          }
        }

        console.log('[WS] Client disconnected')
      },
    })

  /* ─── Handlers ──────────────────────────────────────────── */

  function gameSnapshot(game: ActiveGame, finished = game.chess.isGameOver()) {
    return { ...snapshotGame(game, finished, now()), ...(game.warMatchId ? { warMatchId: game.warMatchId } : {}), ...(game.leadershipMatchId ? { leadershipMatchId: game.leadershipMatchId } : {}),
      presence: { w: game.white.ws?.readyState === 1, b: game.black.ws?.readyState === 1 } }
  }

  function playerInfo(game: ActiveGame) {
    return { white: { id: game.white.id, username: game.white.username, rating: game.white.rating, bounty: game.white.bounty, bountyVersion: game.white.bountyVersion },
      black: { id: game.black.id, username: game.black.username, rating: game.black.rating, bounty: game.black.bounty, bountyVersion: game.black.bountyVersion } }
  }

  async function restoreSession(ws: any, player: AuthenticatedPlayer) {
    pruneResults()
    const id = playerGameMap.get(player.id)
    const game = id ? activeGames.get(id) : undefined
    if (game?.finalization) {
      const participant = game.white.id === player.id ? game.white : game.black
      participant.ws = ws
      sendFinalizing(game, ws)
      return
    }
    if (game && !(await finishIfExpired(game, now())) && !(await finishIfAbsent(game, now()))) {
      const participant = game.white.id === player.id ? game.white : game.black
      clearTimeout(participant.reconnectTimer)
      participant.reconnectBy = undefined
      participant.reconnectTimer = undefined
      participant.ws = ws
      participant.username = player.username
      participant.rating = player.rating
      participant.bounty = player.bounty
      participant.bountyVersion = player.bountyVersion
      try { await persistActive(game) } catch { void persistOrRetry(game); rejectConnection(ws, 'storage_unavailable', 'Unable to save reconnection. Retrying.', 1011); return }
      ws.send(JSON.stringify({ type: 'game_resumed', ...gameSnapshot(game), ...playerInfo(game), color: game.white.id === player.id ? 'w' : 'b' }))
      broadcastState(game)
      return
    }
    const result = results.get(player.id)
    if (result) ws.send(JSON.stringify(result.message))
    else ws.send(JSON.stringify({ type: 'session_idle' }))
  }

  async function finishIfAbsent(game: ActiveGame, at: number) {
    if (activeGames.get(game.id) !== game) return true
    const missing = [game.white, game.black].filter(p => p.reconnectBy !== undefined && p.reconnectBy <= at)
    if (!missing.length) return false
    const both = !game.white.ws && !game.black.ws
    await finishGame(game, both ? 'draw' : missing[0] === game.white ? 'black' : 'white', both ? 'both_disconnected' : 'abandonment')
    return true
  }

  function scheduleReconnectDeadline(game: ActiveGame, player: GamePlayer) {
    if (stopping || fenced) return
    clearTimeout(player.reconnectTimer)
    player.reconnectTimer = setTimeout(() => { void serial(`game:${game.id}`, async () => {
      if (activeGames.get(game.id) !== game) return
      if (!(await finishIfExpired(game, now())) && !(await finishIfAbsent(game, now())) && player.reconnectBy !== undefined)
        scheduleReconnectDeadline(game, player)
    }) }, Math.max(1, Math.ceil((player.reconnectBy ?? now()) - now())))
  }

  async function handleJoinQueue(ws: any, playerIdentity: AuthenticatedPlayer) {
    const { id: userId, username, rating } = playerIdentity

    if (warLookupPending.has(ws.id) || [...warWaiting.values()].some(room => room.has(userId))) {
      ws.send(JSON.stringify({ type: 'error', message: 'Leave the war waiting room first' })); return
    }

    // Check if already in queue
    if (matchmakingQueue.some((p) => p.id === userId)) {
      ws.send(JSON.stringify({ type: 'error', message: 'Already in queue' }))
      return
    }

    // A new queue request must never erase a live game.
    if (playerGameMap.has(userId)) {
      ws.send(JSON.stringify({ type: 'error', message: 'Already in a game' }))
      return
    }

    const player = { ...playerIdentity, rating: rating || 1200, ws }
    results.delete(userId)
    matchmakingQueue.push(player)

    ws.send(JSON.stringify({ type: 'queue_joined', message: 'Searching for opponent...' }))

    // Try to match
    if (matchmakingQueue.length >= 2) {
      const p1 = matchmakingQueue.shift()!
      const p2 = matchmakingQueue.shift()!

      // Randomly assign colors
      const isP1White = Math.random() < 0.5
      const white = isP1White ? p1 : p2
      const black = isP1White ? p2 : p1

      await startGame(white, black)
    }
  }

  function leaveWarWaiting(userId: string, clearAttendance = true) {
    for (const [id, room] of warWaiting) {
      if (clearAttendance) clearReady(room.get(userId), id)
      room.delete(userId)
      if (!room.size) warWaiting.delete(id)
    }
  }

  function rejectWarEntry(ws: any, playerId: string, message: string) {
    const waitingMatchId = [...warWaiting.entries()].find(([, room]) => room.has(playerId))?.[0] ?? null
    safeSend(ws, JSON.stringify({ type: 'war_error', message, waitingMatchId, waitingKind: waitingMatchId ? warWaiting.get(waitingMatchId)?.values().next().value?.contestKind : undefined, searching: matchmakingQueue.some(p => p.id === playerId) }))
  }

  async function handleJoinWar(ws: any, player: AuthenticatedPlayer, matchId: unknown, kind: 'war' | 'leadership' = 'war') {
    if (typeof matchId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchId)) { safeSend(ws, JSON.stringify({ type: 'war_error', message: 'Invalid war match' })); return }
    if (warLookupPending.has(ws.id)) return
    if (playerGameMap.has(player.id) || matchmakingQueue.some(p => p.id === player.id) || [...warWaiting.entries()].some(([id, room]) => id !== matchId && room.has(player.id))) {
      rejectWarEntry(ws, player.id, 'Finish or leave your current game/search first'); return
    }
    if (finishedWarMatches.has(matchId) || (resultSink instanceof ResultOutbox && resultSink.hasPending(matchId))) {
      safeSend(ws, JSON.stringify({ type: 'war_error', message: 'This war match has finished; its result is being saved' })); return
    }
    warLookupPending.add(ws.id)
    try {
      const match = await (kind === 'leadership' ? lookupLeadershipMatch : lookupWarMatch)(player.id, matchId)
      await serial('matchmaking', async () => {
      const session = sessions.get(ws.id)
      if (warLookupCancelled.has(ws.id) || !session?.player || session.player.id !== player.id || ws.readyState !== 1 || Date.now() >= (session.expiresAt ?? 0)) { clearReady({ ...player, ws, contestKind: kind, warReadyAt: match.readyAt }, matchId); return }
      if (match.joinDeadline && Date.now() >= new Date(match.joinDeadline).getTime()) { clearReady({ ...player, ws, contestKind: kind, warReadyAt: match.readyAt }, matchId); throw new CrewError(409, 'The war match entry deadline has passed') }
      if (match.id !== matchId || ![match.whiteId, match.blackId].includes(player.id) || match.whiteId === match.blackId) throw new Error('Invalid war assignment')
      if (playerGameMap.has(player.id) || finishedWarMatches.has(matchId)) throw new Error('Match is already active or finished')
      const room = warWaiting.get(matchId) ?? new Map<string, GamePlayer>()
      warWaiting.set(matchId, room); room.set(player.id, { ...player, ws, contestKind: kind, warReadyAt: match.readyAt })
      safeSend(ws, JSON.stringify({ type: 'war_waiting', matchId, kind }))
      const white = room.get(match.whiteId), black = room.get(match.blackId)
      if (!white || !black || white.ws.readyState !== 1 || black.ws.readyState !== 1) return
      if (playerGameMap.has(white.id) || playerGameMap.has(black.id)) throw new Error('An assigned player is already in a game')
      if ([white, black].some(p => Date.now() >= (sessions.get(p.ws.id)?.expiresAt ?? 0))) throw new Error('A player login expired; reconnect before joining')
      warWaiting.delete(matchId)
      results.delete(white.id); results.delete(black.id)
      await startGame(white, black, matchId, kind === 'war' ? matchId : undefined, kind === 'leadership' ? matchId : undefined)
      })
    } catch (error) { leaveWarWaiting(player.id); rejectWarEntry(ws, player.id, error instanceof CrewError ? error.message : 'War match is unavailable. Refresh the war board and try again.') }
    finally { warLookupPending.delete(ws.id); warLookupCancelled.delete(ws.id) }
  }

  async function startGame(white: GamePlayer, black: GamePlayer, gameId: string = generateId(), warMatchId?: string, leadershipMatchId?: string) {
    return serial(`game:${gameId}`, async () => {
      const chess = new Chess()

      const game: ActiveGame = {
        id: gameId,
        warMatchId, leadershipMatchId,
        chess,
        white: { ...white },
        black: { ...black },
        startedAt: wallNow(),
        drawOfferedBy: null,
        acceptedRequests: new Set(),
        clock: createClock(initialTimeMs, now()),
      }

      activeGames.set(gameId, game)
      playerGameMap.set(white.id, gameId); playerGameMap.set(black.id, gameId)
      try { await persistActive(game) } catch (error) {
        console.error('[ACTIVE] Game creation failed:', error instanceof ActiveGameConflict ? error.message : (error as { code?: string }).code ?? 'storage failure')
        cleanupGame(gameId)
        const message = 'Game storage is unavailable. Please retry.'
        for (const player of [white, black]) {
          safeSend(player.ws, JSON.stringify({ type: warMatchId || leadershipMatchId ? 'war_error' : 'queue_left', message }))
          if (!warMatchId && !leadershipMatchId) safeSend(player.ws, JSON.stringify({ type: 'error', message }))
        }
        return
      }
      // Notify both players
      const gameInfo = {
        type: 'game_start',
        ...gameSnapshot(game, false),
        white: { id: white.id, username: white.username, rating: white.rating, bounty: white.bounty, bountyVersion: white.bountyVersion },
        black: { id: black.id, username: black.username, rating: black.rating, bounty: black.bounty, bountyVersion: black.bountyVersion },
      }

      safeSend(white.ws, JSON.stringify({ ...gameInfo, color: 'w' }))
      safeSend(black.ws, JSON.stringify({ ...gameInfo, color: 'b' }))
      armGame(game)

      console.log(`[MATCH] ${white.username} (W) vs ${black.username} (B) — Game ${gameId}`)
    })
  }

  function armGame(game: ActiveGame) {
      if (stopping || fenced) return
      scheduleDeadline(game)
      game.heartbeat = setInterval(() => { void serial(`game:${game.id}`, async () => {
        if (stopping || activeGames.get(game.id) !== game || await finishIfExpired(game, now())) return
        const message = JSON.stringify({ type: 'clock', gameId: game.id, ply: game.chess.history().length,
          clock: clockSnapshot(game.clock, now()) })
        safeSend(game.white.ws, message)
        safeSend(game.black.ws, message)
      }) }, 1000)
  }

  async function persistActive(game: ActiveGame) {
    const at = now(), savedAt = Math.max(game.startedAt, wallNow())
    const player = (p: GamePlayer) => ({ id: p.id, username: p.username, rating: p.rating, bounty: p.bounty, bountyVersion: p.bountyVersion,
      connected: p.reconnectBy === undefined && !!p.ws, reconnectUntil: p.reconnectBy === undefined ? null : savedAt + Math.ceil(p.reconnectBy - at) })
    if (fenced) throw new ActiveGameConflict('Chess engine is fenced')
    try { await activeStore.save({ version: 1, id: game.id, ...(game.warMatchId ? { warMatchId: game.warMatchId } : {}), ...(game.leadershipMatchId ? { leadershipMatchId: game.leadershipMatchId } : {}),
      pgn: game.chess.pgn(), fen: game.chess.fen(), startedAt: game.startedAt, savedAt,
      white: player(game.white), black: player(game.black), drawOfferedBy: game.drawOfferedBy,
      acceptedRequests: [...game.acceptedRequests], clock: { ...clockRemaining(game.clock, at), running: game.clock.running,
        initialMs: game.clock.initialMs, revision: game.clock.revision },
      ...(game.finalization ? { finalization: { record: game.finalization.record, reason: game.finalization.final.reason as string } } : {}) })
    } catch (error) {
      if (error instanceof ActiveGameConflict) {
        fenced = true
        for (const session of sessions.values()) { try { session.ws.close(1011, 'Chess engine ownership changed; reconnect to the active server') } catch {} }
        for (const active of [...activeGames.values()]) cleanupGame(active.id)
        matchmakingQueue.length = 0
      }
      throw error
    }
    if (fenced) throw new ActiveGameConflict('Chess engine is fenced')
  }

  async function persistOrRetry(game: ActiveGame) {
    clearTimeout(game.storageRetry)
    try { await persistActive(game) }
    catch {
      if (fenced) return
      console.error(`[ACTIVE] Unable to save game ${game.id}; retrying`)
      game.storageRetry = setTimeout(() => { void serial(`game:${game.id}`, async () => { if (activeGames.has(game.id)) await persistOrRetry(game) }) }, 1000)
    }
  }

  async function restoreStoredGame(row: StoredGame) {
    const at = now(), downtime = Math.max(0, wallNow() - row.savedAt), chess = new Chess()
    chess.loadPgn(row.pgn)
    const player = (p: StoredGame['white']): GamePlayer => ({ id: p.id, username: p.username, rating: p.rating,
      bounty: p.bounty, bountyVersion: p.bountyVersion, ws: null,
      reconnectBy: p.connected ? at + reconnectGraceMs : at + (p.reconnectUntil ?? row.savedAt) - wallNow() })
    const clock = { ...row.clock, startedAt: row.clock.running ? at : null }
    if (clock.running === 'w') clock.whiteMs = Math.max(0, clock.whiteMs - downtime)
    if (clock.running === 'b') clock.blackMs = Math.max(0, clock.blackMs - downtime)
    const game: ActiveGame = { id: row.id, warMatchId: row.warMatchId, leadershipMatchId: row.leadershipMatchId, chess, clock, white: player(row.white), black: player(row.black),
      startedAt: row.startedAt, drawOfferedBy: row.drawOfferedBy, acceptedRequests: new Set(row.acceptedRequests) }
    activeGames.set(game.id, game); playerGameMap.set(game.white.id, game.id); playerGameMap.set(game.black.id, game.id)
    if (row.finalization) {
      game.finalization = { record: row.finalization.record,
        final: { ...gameSnapshot(game, true), ...playerInfo(game), result: row.finalization.record.result, reason: row.finalization.reason, persistence: 'queued' } }
      await journalFinalResult(game)
    } else if (!(await finishIfExpired(game, at)) && !(await finishIfAbsent(game, at))) {
      // Rebase monotonic timers once, then persist the new reconnect leases so repeated restarts cannot renew them.
      await persistActive(game)
      scheduleReconnectDeadline(game, game.white); scheduleReconnectDeadline(game, game.black); armGame(game)
    }
  }

  function handleLeaveQueue(ws: any, player: AuthenticatedPlayer) {
    const idx = matchmakingQueue.findIndex((p) => p.id === player.id && p.ws.id === ws.id)
    if (idx !== -1) {
      matchmakingQueue.splice(idx, 1)
      ws.send(JSON.stringify({ type: 'queue_left', message: 'Left the queue' }))
    }
  }

  function currentGame(ws: any, data: any, player: AuthenticatedPlayer) {
    const id = playerGameMap.get(player.id)
    const game = id ? activeGames.get(id) : undefined
    if (!game || data.gameId !== game.id || !ownsGameSocket(game, ws, player.id)) {
      ws.send(JSON.stringify({ type: 'game_unavailable', gameId: data.gameId, message: 'Game is no longer available on this connection' }))
      return null
    }
    return game
  }

  function broadcastState(game: ActiveGame) {
    const message = JSON.stringify({ type: 'game_state', ...gameSnapshot(game, false) })
    safeSend(game.white.ws, message)
    safeSend(game.black.ws, message)
  }

  async function finishGame(game: ActiveGame, result: 'white' | 'black' | 'draw', reason: string, moveMessage?: string) {
    if (activeGames.get(game.id) !== game || game.finalization) return
    stopClock(game.clock, now())
    clearTimeout(game.deadline)
    clearInterval(game.heartbeat)
    clearTimeout(game.white.reconnectTimer)
    clearTimeout(game.black.reconnectTimer)
    const endedAt = new Date(Math.max(game.startedAt, wallNow()))
    game.chess.setHeader('Result', result === 'white' ? '1-0' : result === 'black' ? '0-1' : '1/2-1/2')
    // chess.js writes header values literally; user names must not inject PGN tags.
    const headerName = (name: string) => name.replace(/[\\"\u0000-\u001f\u007f]/g, ' ')
    game.chess.setHeader('White', headerName(game.white.username))
    game.chess.setHeader('Black', headerName(game.black.username))
    game.chess.setHeader('TimeControl', `${game.clock.initialMs / 1000}+0`)
    game.chess.setHeader('EndReason', reason)
    game.chess.setHeader('WhiteClockMs', String(Math.floor(game.clock.whiteMs)))
    game.chess.setHeader('BlackClockMs', String(Math.floor(game.clock.blackMs)))
    const final = { ...gameSnapshot(game, true), ...playerInfo(game), result, reason, persistence: 'queued' }
    game.finalization = { final, moveMessage, record: { id: game.id, whiteId: game.white.id, blackId: game.black.id,
      ...(game.warMatchId ? { warMatchId: game.warMatchId } : {}), ...(game.leadershipMatchId ? { leadershipMatchId: game.leadershipMatchId } : {}), pgn: final.pgn, result, startedAt: new Date(game.startedAt).toISOString(), endedAt: endedAt.toISOString() } }
    await journalFinalResult(game)
  }

  function sendFinalizing(game: ActiveGame, ws: any) {
    safeSend(ws, JSON.stringify({ type: 'game_finalizing', ...gameSnapshot(game, true), ...playerInfo(game),
      color: game.white.id === sessions.get(ws?.id)?.player?.id ? 'w' : 'b', message: 'Saving the game result. Please wait…' }))
  }

  async function journalFinalResult(game: ActiveGame) {
    if (activeGames.get(game.id) !== game || !game.finalization) return
    clearTimeout(game.finalizationRetry)
    try { await persistActive(game); await resultSink.enqueue(game.finalization.record); await activeStore.remove(game.id) }
    catch {
      console.error(`[RESULT] Cannot journal game ${game.id}; keeping it frozen and retrying`)
      sendFinalizing(game, game.white.ws)
      sendFinalizing(game, game.black.ws)
      game.finalizationRetry = setTimeout(() => { void serial(`game:${game.id}`, () => journalFinalResult(game)) }, 1000)
      return
    }
    if (!options.resultSink) game.finalization.final.persistence = 'saved'
    if (game.finalization.moveMessage) {
      safeSend(game.white.ws, game.finalization.moveMessage); safeSend(game.black.ws, game.finalization.moveMessage)
    }
    const final = game.finalization.final
    if (game.warMatchId || game.leadershipMatchId) finishedWarMatches.add(game.warMatchId ?? game.leadershipMatchId!)
    for (const [participant, color] of [[game.white, 'w'], [game.black, 'b']] as const) {
      results.delete(participant.id)
      results.set(participant.id, { gameId: game.id, expiresAt: now() + 300_000,
        message: { type: 'game_resumed', ...final, color } })
    }
    pruneResults()
    const message = JSON.stringify({ type: 'game_over', ...final })
    try { safeSend(game.white.ws, message); safeSend(game.black.ws, message) }
    finally { cleanupGame(game.id) }
    if (!options.resultSink) void notifySaved(game.finalization.record).catch(() => console.error('[RESULT] Saved result notification failed'))
  }

  function safeSend(ws: any, message: string) {
    try { ws?.send(message) } catch { /* Disconnected recipients must not prevent cleanup. */ }
  }

  async function finishIfExpired(game: ActiveGame, at: number) {
    if (fenced || activeGames.get(game.id) !== game || game.finalization) return true
    const loser = expiredColor(game.clock, at)
    if (!loser) return false
    const outcome = timeoutOutcome(game.chess, loser)
    await finishGame(game, outcome.result, outcome.reason)
    return true
  }

  function scheduleDeadline(game: ActiveGame) {
    if (stopping || fenced) return
    clearTimeout(game.deadline)
    const remaining = clockRemaining(game.clock, now())
    const delay = game.clock.running === 'w' ? remaining.whiteMs : remaining.blackMs
    game.deadline = setTimeout(() => { void serial(`game:${game.id}`, async () => {
      if (!(await finishIfExpired(game, now()))) scheduleDeadline(game)
    }) }, Math.max(1, Math.ceil(delay)))
  }

  function handleSync(ws: any, data: any, player: AuthenticatedPlayer) {
    const game = currentGame(ws, data, player)
    if (game) ws.send(JSON.stringify({ type: 'game_state', ...gameSnapshot(game, false) }))
  }

  async function handleMove(ws: any, data: any, player: AuthenticatedPlayer) {
    const id = playerGameMap.get(player.id)
    const game = id ? activeGames.get(id) : undefined
    if (!game || !ownsGameSocket(game, ws, player.id)) {
      ws.send(JSON.stringify({ type: 'game_unavailable', gameId: data.gameId, message: 'Not in a game' }))
      return
    }
    const isWhite = game.white.id === player.id
    const receivedAt = now()
    if (await finishIfExpired(game, receivedAt)) return
    const before = { pgn: game.chess.pgn(), clock: { ...game.clock }, draw: game.drawOfferedBy, accepted: new Set(game.acceptedRequests) }
    const outcome = applyMoveRequest(game, player.id, isWhite ? 'w' : 'b', data)
    if (!outcome.ok) {
      ws.send(JSON.stringify({ type: 'move_rejected', requestId: data.requestId, ...gameSnapshot(game, false), code: outcome.code, message: outcome.message }))
      return
    }
    const move = outcome.move
    switchClock(game.clock, game.chess.turn(), receivedAt)
    if (game.chess.isGameOver()) stopClock(game.clock, receivedAt)
    const message = JSON.stringify({ type: 'move', ...gameSnapshot(game), requestId: data.requestId,
      movedBy: player.id, move: { from: move.from, to: move.to, san: move.san, promotion: move.promotion } })
    if (game.chess.isGameOver()) {
      const result = game.chess.isCheckmate() ? (isWhite ? 'white' : 'black') : 'draw'
      await finishGame(game, result, game.chess.isCheckmate() ? 'checkmate' : game.chess.isStalemate() ? 'stalemate' : 'draw', message)
    } else {
      try { await persistActive(game) } catch {
        game.chess = new Chess(); game.chess.loadPgn(before.pgn); game.clock = before.clock
        game.drawOfferedBy = before.draw; game.acceptedRequests = before.accepted
        safeSend(ws, JSON.stringify({ type: 'move_rejected', requestId: data.requestId, ...gameSnapshot(game, false), code: 'storage_unavailable', message: 'Move was not saved. Please retry.' }))
        scheduleDeadline(game)
        return
      }
      safeSend(game.white.ws, message); safeSend(game.black.ws, message)
      scheduleDeadline(game)
    }
  }

  async function handleResign(ws: any, data: any, player: AuthenticatedPlayer) {
    const game = currentGame(ws, data, player)
    if (game) await finishGame(game, game.white.id === player.id ? 'black' : 'white', 'resignation')
  }

  async function handleDrawOffer(ws: any, data: any, player: AuthenticatedPlayer) {
    const game = currentGame(ws, data, player)
    if (!game) return
    if (game.drawOfferedBy && game.drawOfferedBy !== player.id) {
      ws.send(JSON.stringify({ type: 'error', message: 'Respond to the current draw offer first' }))
      return
    }
    const priorOffer = game.drawOfferedBy
    game.drawOfferedBy = player.id
    try { await persistActive(game) } catch { game.drawOfferedBy = priorOffer; safeSend(ws, JSON.stringify({ type: 'error', message: 'Draw offer was not saved. Please retry.' })); return }
    broadcastState(game)
  }

  async function handleDrawAccept(ws: any, data: any, player: AuthenticatedPlayer) {
    const game = currentGame(ws, data, player)
    if (!game) return
    if (!game.drawOfferedBy || game.drawOfferedBy === player.id) {
      ws.send(JSON.stringify({ type: 'error', message: 'There is no opponent draw offer to accept' }))
      return
    }
    await finishGame(game, 'draw', 'agreement')
  }

  async function handleDrawDecline(ws: any, data: any, player: AuthenticatedPlayer) {
    const game = currentGame(ws, data, player)
    if (!game || !game.drawOfferedBy || game.drawOfferedBy === player.id) return
    const priorOffer = game.drawOfferedBy
    game.drawOfferedBy = null
    try { await persistActive(game) } catch { game.drawOfferedBy = priorOffer; safeSend(ws, JSON.stringify({ type: 'error', message: 'Draw response was not saved. Please retry.' })); return }
    broadcastState(game)
  }

  function ownsGameSocket(game: ActiveGame, ws: any, userId: string) {
    const owns = [game.white, game.black].some(p => p.id === userId && p.ws?.id === ws.id)
    if (!owns) ws.send(JSON.stringify({ type: 'error', message: 'Not in a game on this connection' }))
    return owns
  }

  function cleanupGame(gameId: string) {
    const game = activeGames.get(gameId)
    if (!game) return

    clearTimeout(game.deadline)
    clearInterval(game.heartbeat)
    clearTimeout(game.finalizationRetry)
    clearTimeout(game.storageRetry)
    clearTimeout(game.white.reconnectTimer)
    clearTimeout(game.black.reconnectTimer)

    if (playerGameMap.get(game.white.id) === gameId) playerGameMap.delete(game.white.id)
    if (playerGameMap.get(game.black.id) === gameId) playerGameMap.delete(game.black.id)
    activeGames.delete(gameId)

    console.log(`[GAME] Game ${gameId} ended`)
  }

}

export const chessWs = createChessWs()

