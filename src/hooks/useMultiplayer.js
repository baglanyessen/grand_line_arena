import { useState, useCallback, useRef, useEffect } from 'react'
import { WS_URL, getToken } from '../lib/api'
import { emptyOnlineGame, receiveOnlineState, canSubmitMove } from '../lib/chessState'
import { receiveClockTick } from '../lib/chessClock'
import { useAuth } from '../context/AuthContext'
import { mergeBountyProfile } from '../lib/bounty'

export default function useMultiplayer() {
  const { applyBountyProfile, trackSettlement, recordSettlement } = useAuth()
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [online, setOnline] = useState(emptyOnlineGame)
  const [isMovePending, setIsMovePending] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [warWaitingId, setWarWaitingId] = useState(null)
  const warTargetRef = useRef(null)
  const contestKindRef = useRef('war')
  const stateRef = useRef(online)
  const wsRef = useRef(null)
  const authenticatedRef = useRef(false)
  const userRef = useRef(null)
  const pendingRef = useRef(null)
  const timerRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const connectRef = useRef(null)
  const retryCountRef = useRef(0)
  const stoppedRef = useRef(false)
  const retryAllowedRef = useRef(true)

  const commit = useCallback(next => { stateRef.current = next; setOnline(next) }, [])
  const clearPending = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = null
    pendingRef.current = null
    setIsMovePending(false)
  }, [])
  const send = useCallback(data => {
    if (!authenticatedRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return false
    try { wsRef.current.send(JSON.stringify(data)); return true }
    catch { setConnectionError('Connection lost. The board has been frozen.'); return false }
  }, [])
  const freeze = useCallback(message => {
    clearPending()
    if (stateRef.current.gameId && stateRef.current.phase !== 'finished') commit({ ...stateRef.current, phase: 'disconnected' })
    setConnectionError(message)
  }, [clearPending, commit])
  const synchronize = useCallback(() => {
    const current = stateRef.current
    if (!current.gameId || ['finished', 'disconnected'].includes(current.phase)) return
    clearTimeout(timerRef.current)
    commit({ ...current, phase: 'syncing' })
    setConnectionError('Waiting for the server position…')
    if (!send({ type: 'sync_game', gameId: current.gameId })) {
      freeze('Unable to synchronize. The board has been frozen.')
      wsRef.current?.close()
      return
    }
    timerRef.current = setTimeout(() => {
      freeze('The server did not respond. Reconnect before starting a new game.')
      wsRef.current?.close()
    }, 5000)
  }, [commit, send, freeze])

  const connect = useCallback(user => {
    userRef.current = user
    const ready = wsRef.current?.readyState
    if (ready === WebSocket.OPEN || ready === WebSocket.CONNECTING) return
    const token = getToken()
    if (!token) { setConnectionError('Sign in before playing online.'); return }
    clearTimeout(reconnectTimerRef.current)
    retryAllowedRef.current = true
    authenticatedRef.current = false
    setIsConnected(false)
    setConnectionError('')
    if (stateRef.current.gameId && stateRef.current.phase !== 'finished') {
      commit({ ...stateRef.current, phase: 'reconnecting' })
      setIsReconnecting(true)
    }
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws
    ws.onopen = () => {
      if (wsRef.current === ws) ws.send(JSON.stringify({ type: 'authenticate', token }))
    }
    ws.onmessage = event => {
      if (wsRef.current !== ws) return
      let data
      try { data = JSON.parse(event.data) } catch { return }
      if (!data || typeof data !== 'object') return
      if (data.type === 'authenticated') {
        if (data.user?.id !== userRef.current?.id) { retryAllowedRef.current = false; setConnectionError('Account mismatch. Sign in again.'); ws.close(); return }
        authenticatedRef.current = true
        applyBountyProfile(data.user)
        retryCountRef.current = 0
        setIsConnected(true)
        setConnectionError('')
        if (warTargetRef.current) ws.send(JSON.stringify({ type: contestKindRef.current === 'leadership' ? 'join_leadership_match' : 'join_war_match', matchId: warTargetRef.current }))
        return
      }
      if (data.type === 'war_waiting') { contestKindRef.current = data.kind ?? 'war'; setWarWaitingId(data.matchId); setIsSearching(true); setConnectionError(''); return }
      if (data.type === 'war_left' || data.type === 'war_error') {
        warTargetRef.current = data.waitingMatchId ?? null
        if (data.waitingKind) contestKindRef.current = data.waitingKind
        setWarWaitingId(data.waitingMatchId ?? null); setIsSearching(!!data.waitingMatchId || !!data.searching)
        if (data.type === 'war_error') setConnectionError(data.message)
        return
      }
      if (data.type === 'session_idle') {
        clearPending()
        setIsReconnecting(false)
        if (stateRef.current.gameId && stateRef.current.phase !== 'finished') {
          commit({ ...stateRef.current, phase: 'unavailable' })
          setConnectionError('No active match was found. It may have expired or the server restarted.')
        }
        return
      }
      if (data.type === 'game_saved' || data.type === 'war_settled') {
        if (data.type === 'game_saved') recordSettlement(data.gameId, data.bountyReward)
        for (const profile of data.profiles ?? []) applyBountyProfile(profile)
        const current = stateRef.current
        if (current.gameId === data.gameId && current.matchResult)
          commit({ ...current, opponent: mergeBountyProfile(current.opponent, data.profiles?.find(profile => profile.id === current.opponent?.id)),
            matchResult: { ...current.matchResult, persistence: 'saved', bountyReward: data.bountyReward, warSettlement: data.warSettlement } })
        else if (current.matchResult && data.warSettlement?.matchIds.includes(current.gameId))
          commit({ ...current, matchResult: { ...current.matchResult, warSettlement: data.warSettlement } })
        return
      }
      if (data.type === 'queue_joined') { setIsSearching(true); setConnectionError(''); return }
      if (data.type === 'queue_left') { setIsSearching(false); return }
      if (data.type === 'clock') {
        try {
          const next = receiveClockTick(stateRef.current, data)
          if (next !== stateRef.current) commit(next)
        } catch { synchronize() }
        return
      }
      if (['game_start', 'game_resumed', 'game_finalizing', 'move', 'game_state', 'move_rejected', 'game_over'].includes(data.type)) {
        const previous = stateRef.current
        let next
        try { next = receiveOnlineState(previous, data) }
        catch { synchronize(); return }
        if (next === previous) return
        commit(next)
        if (data.type === 'game_start' || data.type === 'game_resumed') { warTargetRef.current = null; setWarWaitingId(null) }
        if (data.type === 'game_over') trackSettlement(data.gameId)
        setIsReconnecting(false)
        setIsSearching(false)
        const pending = pendingRef.current
        if (data.type === 'game_start' || data.type === 'game_resumed' || data.type === 'game_finalizing' || data.type === 'game_over' ||
            (data.type === 'game_state' && previous.phase === 'syncing') ||
            (data.requestId === pending?.requestId && (data.type === 'move_rejected' || data.movedBy === userRef.current?.id))) clearPending()
        setConnectionError(['move_rejected', 'game_finalizing'].includes(data.type) ? data.message : '')
        return
      }
      if (data.type === 'game_unavailable') {
        if (data.gameId === stateRef.current.gameId && stateRef.current.phase !== 'finished') {
          clearPending()
          commit({ ...stateRef.current, phase: 'unavailable' })
          setConnectionError(data.message)
        }
        return
      }
      if (data.type === 'error') {
        const duplicateWithoutMatch = data.code === 'duplicate_connection' && !stateRef.current.gameId
        if (['authentication_failed', 'authentication_expired'].includes(data.code) || duplicateWithoutMatch) {
          retryAllowedRef.current = false
          setIsReconnecting(false)
        }
        setConnectionError(data.message || 'Unable to complete the online action.')
      }
    }
    ws.onclose = () => {
      if (wsRef.current !== ws) return
      authenticatedRef.current = false
      setIsConnected(false)
      setIsSearching(false)
      clearPending()
      if (stateRef.current.gameId && stateRef.current.phase !== 'finished') commit({ ...stateRef.current, phase: 'disconnected' })
      if (!retryAllowedRef.current || stoppedRef.current) return
      setConnectionError('Connection lost. Reconnecting automatically… Your clock keeps running.')
      setIsReconnecting(true)
      const delay = Math.min(500 * 2 ** Math.min(retryCountRef.current++, 4), 8000)
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(() => {
        if (!stoppedRef.current) connectRef.current?.(userRef.current)
      }, delay)
    }
    ws.onerror = () => { if (wsRef.current === ws) setConnectionError('Cannot reach the chess server.') }
  }, [commit, clearPending, synchronize, freeze, applyBountyProfile, trackSettlement, recordSettlement])

  useEffect(() => { connectRef.current = connect }, [connect])
  useEffect(() => {
    stoppedRef.current = false
    return () => {
      stoppedRef.current = true
      clearTimeout(timerRef.current)
      clearTimeout(reconnectTimerRef.current)
      authenticatedRef.current = false
      const ws = wsRef.current
      wsRef.current = null
      ws?.close()
    }
  }, [])

  const clearGame = useCallback(() => {
    // A live match must be ended by the server, not silently replaced with practice.
    if (stateRef.current.gameId && !['finished', 'unavailable'].includes(stateRef.current.phase)) return false
    if (stateRef.current.phase === 'finished') send({ type: 'ack_result', gameId: stateRef.current.gameId })
    clearPending()
    commit(emptyOnlineGame())
    return true
  }, [clearPending, commit, send])
  const findMatch = useCallback(() => {
    if (stateRef.current.gameId) return
    send({ type: 'join_queue' })
  }, [send])
  const leaveQueue = useCallback(() => {
    if (warTargetRef.current) { warTargetRef.current = null; setWarWaitingId(null); send({ type: 'leave_war_match' }) }
    else send({ type: 'leave_queue' })
  }, [send])
  const joinWarMatch = useCallback((matchId, kind = 'war') => {
    if (stateRef.current.gameId && !clearGame()) { setConnectionError('Finish your current game before entering this match.'); return }
    warTargetRef.current = matchId
    contestKindRef.current = kind
    setIsSearching(true)
    if (!send({ type: kind === 'leadership' ? 'join_leadership_match' : 'join_war_match', matchId })) setConnectionError('Reconnect before entering this match.')
  }, [send, clearGame])
  const emitMove = useCallback(move => {
    const current = stateRef.current
    if (!canSubmitMove(current, pendingRef.current, move)) return false
    const requestId = crypto.randomUUID()
    pendingRef.current = { requestId }
    setIsMovePending(true)
    setConnectionError('')
    if (!send({ type: 'move', gameId: current.gameId, ply: current.snapshot.ply, requestId, ...move })) {
      freeze('Move was not sent. The board has been frozen.')
      wsRef.current?.close()
      return false
    }
    timerRef.current = setTimeout(synchronize, 8000)
    return true
  }, [send, synchronize, freeze])
  const command = useCallback(type => {
    const current = stateRef.current
    if (current.phase !== 'playing' || pendingRef.current) return
    send({ type, gameId: current.gameId })
  }, [send])

  return { ...online, isConnected, connectionError, isSearching, isMovePending, isReconnecting, warWaitingId, joinWarMatch,
    connect, clearGame, findMatch, leaveQueue, emitMove,
    resign: () => command('resign'), offerDraw: () => command('draw_offer'),
    acceptDraw: () => command('draw_accept'), declineDraw: () => command('draw_decline') }
}
