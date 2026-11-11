import { useCallback, useEffect, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { BookOpen, Crown, Puzzle, RotateCcw, Search } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import useBoardSize from '../hooks/useBoardSize'
import { cloneGame, needsPromotion } from '../lib/chessState'
import { PUZZLES, OPENINGS, ENDGAMES, openingLesson, studyGame, firstStudentPosition, attemptLesson, endgameOutcome } from '../lib/training'
import { onePiecePieces } from './chess/OnePiecePieces'
import PromotionDialog from './chess/PromotionDialog'
import MentorPanel from './MentorPanel'
import api from '../lib/api'
import './BotArena.css'
import './TrainingPage.css'

function readProgress(key) { try { const saved = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(saved) ? saved.filter(id => typeof id === 'string').slice(-500) : [] } catch { return [] } }
export default function TrainingPage() {
  const { user } = useAuth(), [mode, setMode] = useState('puzzles'), [selected, setSelected] = useState({}), [side, setSide] = useState('w')
  const key = `gla_drills_${user.id}`, [completed, setCompleted] = useState(() => readProgress(key))
  const finish = useCallback(id => setCompleted(current => current.includes(id) ? current : [...current, id].slice(-500)), [])
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(completed)) } catch {} }, [key, completed])
  const entries = mode === 'puzzles' ? PUZZLES : mode === 'openings' ? OPENINGS.map(item => openingLesson(item, side)).filter(item => side === 'w' || item.solution.length >= 2) : ENDGAMES
  const active = entries.find(item => item.id === selected[mode]) ?? entries[0]
  return <div className="bot-page training-page"><header className="bot-heading"><div><p className="eyebrow">THE CREW'S TRAINING DECK</p><h1>Build your chess instincts.</h1><p>Short drills. Real positions. A teacher when you need one.</p></div><span className="bot-training-tag">PROGRESS ON THIS DEVICE · NO BOUNTY</span></header>
    <nav className="training-modes" aria-label="Training mode">{[['puzzles', 'Puzzles', Puzzle], ['openings', 'Openings', BookOpen], ['endgames', 'Endgames', Crown], ['review', 'Mistake review', Search]].map(([id, label, Icon]) => <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}><Icon size={17} />{label}</button>)}</nav>
    {mode === 'review' ? <MistakeReview onComplete={finish} /> : <>
      <section className="bot-setup"><label>Choose exercise<select value={active.id} onChange={event => setSelected(current => ({ ...current, [mode]: event.target.value }))}>{entries.map(item => <option key={item.id} value={item.id}>{completed.includes(`${mode}:${item.id}`) ? '✓ ' : ''}{item.title}</option>)}</select></label>
        {mode === 'openings' && <label>Practise as<select value={side} onChange={event => setSide(event.target.value)}><option value="w">White</option><option value="b">Black</option></select></label>}
        <span className="bot-save-note">{entries.length} exercises · {entries.filter(item => completed.includes(`${mode}:${item.id}`)).length} completed</span>
      </section>
      <StudyBoard key={`${mode}:${active.id}:${side}`} lesson={active} mode={mode} onComplete={finish} />
    </>}
    <p className="training-credit">Training catalogue adapted from <a href="https://github.com/Iamsdt/chess" target="_blank" rel="noreferrer">Chess King by Shudipto Trafder</a> · <a href={`${import.meta.env.BASE_URL}licenses/chess-king-MIT.txt`} target="_blank" rel="noreferrer">MIT license</a>. Exercise lines were checked for legality; they are not a claim that other moves lose.</p>
  </div>
}

export function StudyBoard({ lesson, mode, onComplete }) {
  const initialMoves = mode === 'endgames' ? [] : firstStudentPosition(lesson)
  const [state, setState] = useState(() => ({ game: studyGame(lesson, initialMoves), moves: initialMoves, complete: mode !== 'endgames' && initialMoves.length === lesson.solution.length }))
  const current = useRef(state), mounted = useRef(true), version = useRef(0)
  const [thinking, setThinking] = useState(false), [error, setError] = useState(''), [feedback, setFeedback] = useState(''), [hint, setHint] = useState(0), [annotation, setAnnotation] = useState(null), [promotion, setPromotion] = useState(null)
  const [style, setStyle] = useState('patient'), [language, setLanguage] = useState('en'), [configured, setConfigured] = useState(null), [retry, setRetry] = useState(0)
  const width = Math.min(useBoardSize(), 560), color = lesson.playerColor ?? new Chess(lesson.fen).turn(), game = state.game
  const outcome = mode === 'endgames' ? endgameOutcome(game, color, lesson.goal) : null
  const finished = mode === 'endgames' ? outcome.finished : state.complete
  const commit = next => { current.current = next; setState(next) }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; version.current++ } }, [])
  useEffect(() => { let ignore = false; api.get('/bot/status').then(result => { if (!ignore) setConfigured(result.coachConfigured) }).catch(() => {}); return () => { ignore = true } }, [])
  useEffect(() => { if ((mode !== 'endgames' && state.complete) || outcome?.success) onComplete(`${mode}:${lesson.id}`) }, [state.complete, outcome?.success, mode, lesson.id, onComplete])
  useEffect(() => { setAnnotation(null); setPromotion(null) }, [game])
  useEffect(() => {
    if (mode !== 'endgames' || outcome.finished || game.turn() === color) { setThinking(false); return }
    let ignore = false
    const generation = version.current
    setThinking(true); setError('')
    api.post('/bot/study/move', { pgn: game.pgn(), playerColor: color, level: 'captain' }).then(result => {
      if (ignore || !mounted.current || generation !== version.current || current.current !== state) return
      if (result.fen !== game.fen()) throw new Error('The engine answered for another position')
      const copy = cloneGame(game), move = result.move
      copy.move({ from: move.slice(0, 2), to: move.slice(2, 4), ...(move[4] ? { promotion: move[4] } : {}) })
      commit({ ...state, game: copy }); setThinking(false)
    }).catch(failure => { if (!ignore && mounted.current && generation === version.current) { setError(failure.message); setThinking(false) } })
    return () => { ignore = true }
  }, [state, mode, color, retry])
  const attempt = move => {
    const value = current.current
    if (finished || value.game.turn() !== color) return false
    if (mode === 'endgames') {
      try { const copy = cloneGame(value.game); copy.move(move); commit({ ...value, game: copy }); setFeedback(''); return true } catch { return false }
    }
    const result = attemptLesson(lesson, value.moves, move)
    if (!result.accepted) { setFeedback(result.reason === 'illegal' ? 'That move is not legal here.' : 'That is a legal move, but this drill follows a different idea. Try the lesson line.'); return false }
    commit({ game: studyGame(lesson, result.moves), moves: result.moves, complete: result.complete }); setFeedback(result.complete ? 'Exercise complete.' : 'Good. Find your next move.'); setHint(0); return true
  }
  const drop = ({ sourceSquare, targetSquare }) => {
    if (!targetSquare || finished || game.turn() !== color || promotion) return false
    if (needsPromotion(game, sourceSquare, targetSquare)) { setPromotion({ from: sourceSquare, to: targetSquare }); return false }
    return attempt({ from: sourceSquare, to: targetSquare })
  }
  const next = lesson.solution?.[state.moves.length], marked = annotation?.fen === game.fen() ? annotation : hint >= 2 && next ? { squares: [next.slice(0, 2), ...(hint >= 3 ? [next.slice(2, 4)] : [])], arrows: hint >= 3 ? [{ startSquare: next.slice(0, 2), endSquare: next.slice(2, 4), color: '#1d8979' }] : [] } : null
  const reset = () => { version.current++; const moves = mode === 'endgames' ? [] : firstStudentPosition(lesson); commit({ game: studyGame(lesson, moves), moves, complete: mode !== 'endgames' && moves.length === lesson.solution.length }); setHint(0); setFeedback(''); setError(''); setThinking(false) }
  return <div className="bot-layout"><section className="bot-board-column" aria-label="Exercise chessboard"><div className="training-exercise-heading"><span>{mode.toUpperCase()} · {color === 'w' ? 'WHITE' : 'BLACK'} TO PRACTISE</span><h2>{lesson.title}</h2><p>{lesson.description}</p>{mode === 'endgames' && <strong>{lesson.goalText}</strong>}</div>
    <div className="bot-board-frame" style={{ width: width + 20 }}><div style={{ width, height: width }}><Chessboard options={{ id: 'StudyBoard', position: game.fen(), pieces: onePiecePieces, boardOrientation: color === 'w' ? 'white' : 'black', onPieceDrop: drop,
      canDragPiece: ({ piece }) => !finished && !promotion && game.turn() === color && piece.pieceType[0] === color,
      darkSquareStyle: { backgroundColor: '#4896b4' }, lightSquareStyle: { backgroundColor: '#fff0c9' }, animationDurationInMs: 120,
      arrows: marked?.arrows ?? [], squareStyles: Object.fromEntries((marked?.squares ?? []).map(square => [square, { backgroundColor: '#eaa45f99' }])) }} /></div></div>
    <p className="bot-position-status" role="status">{thinking ? 'Stockfish is replying...' : outcome?.finished ? outcome.text : finished ? 'Exercise complete.' : game.isCheck() ? 'You are in check.' : 'Find your move.'}</p>
    {feedback && !finished && <p className="training-feedback" role="status">{feedback}</p>}
    {error && <p className="bot-error" role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Retry engine</button></p>}
    <div className="bot-game-actions"><button onClick={reset}><RotateCcw size={14} /> Reset exercise</button>{mode !== 'endgames' && <button disabled={finished} onClick={() => setHint(value => Math.min(3, value + 1))}>Hint</button>}
      {mode === 'endgames' && <button disabled={!game.history().length} onClick={() => { version.current++; const copy = cloneGame(game); copy.undo(); if (copy.turn() !== color && copy.history().length) copy.undo(); commit({ ...state, game: copy }); setError('') }}>Take back turn</button>}
    </div>
    {hint > 0 && !finished && <p className="bot-save-note">{hint === 1 ? `Look for the ${lesson.theme ?? 'opening'} idea in the lesson.` : hint === 2 ? 'The highlighted piece starts the lesson line.' : 'The arrow shows the next move in the lesson line.'}</p>}
    {promotion && <PromotionDialog color={color} onCancel={() => setPromotion(null)} onChoose={piece => { attempt({ ...promotion, promotion: piece }); setPromotion(null) }} />}
  </section><aside className="bot-companion"><MentorPanel key={lesson.id} game={game} playerColor={color} style={style} language={language} onStyle={setStyle} onLanguage={setLanguage} configured={configured} onHighlight={setAnnotation} /></aside></div>
}

function MistakeReview({ onComplete }) {
  const { user } = useAuth(), [games, setGames] = useState([]), [selected, setSelected] = useState(''), [loaded, setLoaded] = useState(null), [cursor, setCursor] = useState(0), [results, setResults] = useState([]), [index, setIndex] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const generation = useRef(0), lock = useRef(false)
  const [pastedPgn, setPastedPgn] = useState(''), [pastedColor, setPastedColor] = useState('w')
  useEffect(() => { let ignore = false; api.get('/games/?limit=20&offset=0').then(value => { if (!ignore) setGames(value.games) }).catch(failure => { if (!ignore) setError(failure.message) }); return () => { ignore = true; generation.current++ } }, [])
  const load = (pgn, color, title) => {
    try {
      const full = new Chess(); full.loadPgn(pgn)
      if (full.history().length > 600) throw new Error('Training review supports at most 600 half-moves')
      const prefix = new Chess(full.getHeaders().FEN), positions = []
      for (const move of full.history({ verbose: true })) { prefix.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) }); if (move.color === color) positions.push(prefix.pgn()) }
      generation.current++; lock.current = false; setLoaded({ positions, color, title }); setResults([]); setCursor(0); setIndex(0); setError('')
    } catch { setError('This game could not be loaded for review.') }
  }
  const analyze = async () => {
    if (!loaded || lock.current) return
    lock.current = true; setBusy(true); setError('')
    const version = generation.current
    try {
      for (let i = cursor; i < Math.min(cursor + 6, loaded.positions.length); i++) {
        if (version !== generation.current) return
        const result = await api.post('/bot/engine', { pgn: loaded.positions[i], playerColor: loaded.color, action: 'review', language: 'en' })
        if (version !== generation.current) return
        if (result.review && ['mistake', 'blunder'].includes(result.review.quality) && result.review.bestMove) setResults(current => [...current, { ...result.review, id: `${i}-${result.review.bestMove}` }])
        setCursor(i + 1)
      }
    } catch (failure) { if (version === generation.current) setError(failure.message) }
    finally { if (version === generation.current) { lock.current = false; setBusy(false) } }
  }
  const current = results[index]
  return <div className="training-review"><section className="bot-setup"><label>Recent saved game<select disabled={busy} value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose a game</option>{games.map(game => <option key={game.id} value={game.id}>{game.whiteName} vs {game.blackName} · {new Date(game.endedAt).toLocaleDateString()}</option>)}</select></label>
    <button disabled={!selected || busy} onClick={async () => { setBusy(true); try { const result = await api.get(`/games/${selected}`); load(result.game.pgn, result.game.whiteId === user.id ? 'w' : 'b', 'Saved match') } catch (failure) { setError(failure.message) } finally { setBusy(false) } }}>Load game</button>
    <button disabled={busy} onClick={() => { try { const saved = JSON.parse(sessionStorage.getItem(`gla_training_${user.id}`)); if (!saved?.pgn) throw new Error(); load(saved.pgn, saved.playerColor, 'Current bot game') } catch { setError('Play a bot game in this tab first.') } }}>Use current bot game</button>
  </section>
  <details className="training-pgn-import"><summary>Review a PGN</summary><label>Training PGN<textarea value={pastedPgn} onChange={event => setPastedPgn(event.target.value)} maxLength={24000} rows={3} disabled={busy} /></label><label>Your side in this PGN<select value={pastedColor} onChange={event => setPastedColor(event.target.value)} disabled={busy}><option value="w">White</option><option value="b">Black</option></select></label><button disabled={busy || !pastedPgn.trim()} onClick={() => load(pastedPgn, pastedColor, 'Imported training game')}>Load PGN</button></details>
  {loaded && <section className="training-review-controls"><h2>{loaded.title}</h2><p>{cursor} / {loaded.positions.length} of your moves analysed · {results.length} possible mistakes found</p><button className="bot-primary" disabled={busy || cursor >= loaded.positions.length} onClick={analyze}>{busy ? 'Analysing...' : 'Analyse next 6 moves'}</button><p className="bot-save-note">Short engine searches identify candidates for practice, not a perfect accuracy score. Analysis pauses in small batches; you can continue without replaying the earlier batch.</p></section>}
  {error && <p className="bot-error" role="alert">{error}</p>}
  {loaded && cursor > 0 && !results.length && <p>No mistakes found in the analysed section.</p>}
  {current && <><label className="training-result-picker">Choose mistake<select value={index} onChange={event => setIndex(Number(event.target.value))}>{results.map((result, i) => <option key={result.id} value={i}>{i + 1}. {result.played} · {result.quality}</option>)}</select></label>
    <StudyBoard key={current.id} lesson={{ id: current.id, title: 'Find the engine alternative', fen: current.beforeFen, solution: [current.bestMove], theme: 'review', description: `You played ${current.played}. Explore the engine's alternative from the position before that move.`, playerColor: loaded.color }} mode="review" onComplete={onComplete} />
  </>}
  {!loaded && <p className="training-empty">Load one of your recent matches or your current bot game. Your teacher will turn possible mistakes into positions you can practise.</p>}
  </div>
}
