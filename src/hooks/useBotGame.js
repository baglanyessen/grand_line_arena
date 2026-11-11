import { useCallback, useEffect, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { cloneGame } from '../lib/chessState'
import api from '../lib/api'

function restore(key) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key))
    if (saved && ['w', 'b'].includes(saved.playerColor) && ['rookie', 'navigator', 'captain'].includes(saved.level) && saved.pgn.length < 24000) {
      const game = new Chess(); game.loadPgn(saved.pgn)
      if (!game.getHeaders().FEN && game.history().length <= 600) return { game, playerColor: saved.playerColor, level: saved.level, resigned: !!saved.resigned }
    }
  } catch { /* A corrupt local training save must not prevent opening the room. */ }
  return { game: new Chess(), playerColor: 'w', level: 'rookie', resigned: false }
}

export default function useBotGame(userId) {
  const key = `gla_training_${userId}`
  const [session, setSession] = useState(() => restore(key))
  const sessionRef = useRef(session)
  const [thinking, setThinking] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [coach, setCoach] = useState(null), [coachThinking, setCoachThinking] = useState(false), [coachError, setCoachError] = useState('')
  const [style, setStyle] = useState('cheeky'), [language, setLanguage] = useState('en'), [autoCoach, setAutoCoach] = useState(true)
  const [configured, setConfigured] = useState(null)
  const [coachSilentCheck, setCoachSilentCheck] = useState(false)
  const generation = useRef(0), adviceId = useRef(0), mounted = useRef(true)
  const recentLessons = useRef([])
  const commit = useCallback(next => { sessionRef.current = next; setSession(next) }, [])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current++; adviceId.current++ }
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify({ pgn: session.game.pgn(), playerColor: session.playerColor, level: session.level, resigned: session.resigned })) } catch {}
  }, [key, session])
  useEffect(() => { let cancelled = false; api.get('/bot/status').then(value => { if (!cancelled) setConfigured(value.coachConfigured) }).catch(() => {}); return () => { cancelled = true } }, [])
  useEffect(() => { adviceId.current++; setCoach(null); setCoachThinking(false); setCoachError('') }, [style, language])

  const advise = useCallback(async (kind, target = sessionRef.current, automatic = false) => {
    const id = ++adviceId.current, version = generation.current, fen = target.game.fen()
    setCoachThinking(true); setCoachSilentCheck(automatic); setCoachError(''); setCoach(null)
    try {
      const result = await api.post('/bot/coach', { pgn: target.game.pgn(), playerColor: target.playerColor, kind, style, language, automatic, recentLessons: recentLessons.current })
      if (mounted.current && version === generation.current && id === adviceId.current && sessionRef.current.game.fen() === fen && result.fen === fen) {
        setCoach(result.silent ? null : { ...result, kind })
        if (result.lessonId) recentLessons.current = [...recentLessons.current, result.lessonId].slice(-8)
        if (result.source === 'openai') setConfigured(true)
        if (result.reason === 'not_configured') setConfigured(false)
      }
    } catch (failure) {
      if (mounted.current && version === generation.current && id === adviceId.current) setCoachError(failure.message)
    } finally { if (mounted.current && id === adviceId.current) { setCoachThinking(false); setCoachSilentCheck(false) } }
  }, [style, language])
  // Engine work follows the saved position, so returning to this page resumes a pending bot turn.
  // Advice settings do not restart an in-flight chess search.
  const adviceRef = useRef(advise), autoRef = useRef(autoCoach)
  useEffect(() => { adviceRef.current = advise; autoRef.current = autoCoach }, [advise, autoCoach])
  useEffect(() => {
    if (session.resigned || session.game.isGameOver() || session.game.history().length >= 600 || session.game.turn() === session.playerColor) { setThinking(false); return }
    let cancelled = false
    const version = generation.current
    setThinking(true); setError('')
    api.post('/bot/move', { pgn: session.game.pgn(), playerColor: session.playerColor, level: session.level }).then(result => {
      if (cancelled || !mounted.current || version !== generation.current || sessionRef.current !== session) return
      if (result.fen !== session.game.fen() || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(result.move ?? '')) throw new Error('The bot returned an invalid move. Please retry.')
      const game = cloneGame(session.game), uci = result.move
      game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) })
      const next = { ...session, game }; commit(next); setThinking(false)
      if (autoRef.current) void adviceRef.current(game.history({ verbose: true }).some(move => move.color === session.playerColor) ? 'review' : 'hint', next, true)
    }).catch(failure => { if (!cancelled && mounted.current && version === generation.current) { setError(failure.message); setThinking(false) } })
    return () => { cancelled = true }
  }, [session, retry, commit])

  const invalidateAdvice = () => { adviceId.current++; setCoach(null); setCoachThinking(false); setCoachError('') }
  const makeMove = useCallback((from, to, promotion) => {
    const current = sessionRef.current
    if (current.resigned || current.game.isGameOver() || current.game.history().length >= 600 || current.game.turn() !== current.playerColor) return false
    try {
      const game = cloneGame(current.game); game.move({ from, to, ...(promotion ? { promotion } : {}) })
      invalidateAdvice(); setError(''); commit({ ...current, game }); return true
    } catch { return false }
  }, [commit])
  const start = useCallback((playerColor, level) => {
    recentLessons.current = []
    generation.current++; invalidateAdvice(); setError(''); setThinking(false)
    commit({ game: new Chess(), playerColor, level, resigned: false })
  }, [commit])
  const takeBack = useCallback(() => {
    const current = sessionRef.current, game = cloneGame(current.game)
    if (!game.history({ verbose: true }).some(move => move.color === current.playerColor)) return
    generation.current++; invalidateAdvice(); setError('')
    game.undo()
    if (game.turn() !== current.playerColor && game.history().length) game.undo()
    commit({ ...current, game, resigned: false })
  }, [commit])
  const resign = useCallback(() => {
    generation.current++; invalidateAdvice(); setThinking(false); commit({ ...sessionRef.current, resigned: true })
  }, [commit])
  return { ...session, thinking, error, coach, coachThinking, coachSilentCheck, coachError, configured, style, setStyle, language, setLanguage,
    autoCoach, setAutoCoach, makeMove, start, takeBack, resign, advise, retry: () => setRetry(value => value + 1) }
}
