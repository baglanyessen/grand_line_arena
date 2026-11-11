import { useEffect, useRef, useState } from 'react'
import { Bot, MessageCircle, Send, Sparkles, Lightbulb, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { StrawHatEmblem } from './chess/OnePiecePieces'
import api from '../lib/api'

function savedConversation(key) {
  try { return JSON.parse(sessionStorage.getItem(key) ?? '[]').filter(item => ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.length <= 1800 && typeof item.fen === 'string').slice(-10) } catch { return [] }
}
export default function MentorPanel({ game, playerColor, style = 'cheeky', language = 'en', onStyle, onLanguage, configured,
  coach, coachThinking, coachSilentCheck, coachError, onHint, onReview, canHint, canReview, autoCoach, onAutoCoach, onHighlight }) {
  const { user } = useAuth(), key = `gla_teacher_chat_${user.id}`, fen = game.fen()
  const [tab, setTab] = useState('engine'), [cards, setCards] = useState([]), [messages, setMessages] = useState(() => savedConversation(key))
  const [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const mounted = useRef(true), locked = useRef(false), sequence = useRef(0)
  const messageList = useRef(null)
  useEffect(() => { if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight }, [messages, cards, tab])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++ } }, [])
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(messages.slice(-10))) } catch {} }, [key, messages])
  const engine = async action => {
    if (locked.current) return
    locked.current = true; setBusy(true); setError('')
    const id = ++sequence.current, requestedFen = fen
    try {
      const result = await api.post('/bot/engine', { pgn: game.pgn(), playerColor, action, language })
      if (mounted.current && sequence.current === id) setCards(current => [...current, { ...result, requestedFen, action, id: crypto.randomUUID() }].slice(-8))
    } catch (failure) { if (mounted.current && sequence.current === id) setError(failure.message) }
    finally { if (mounted.current && sequence.current === id) { locked.current = false; setBusy(false) } }
  }
  const ask = async event => {
    event.preventDefault()
    const question = draft.trim()
    if (!question || locked.current) return
    locked.current = true; setBusy(true); setError('')
    const id = ++sequence.current, requestedFen = fen
    try {
      const result = await api.post('/bot/chat', { pgn: game.pgn(), playerColor, message: question, messages: messages.slice(-10).map(({ role, content }) => ({ role, content })), style, language })
      if (!result.available) throw new Error(result.reason === 'not_configured' ? 'AI chat is not connected yet. Engine chat is available without it.' : 'Your AI teacher could not reply. Please try again.')
      if (mounted.current && sequence.current === id) {
        setMessages(current => [...current, { role: 'user', content: question, fen: requestedFen }, { role: 'assistant', content: result.text, fen: requestedFen }].slice(-10))
        setDraft('')
      }
    } catch (failure) { if (mounted.current && sequence.current === id) setError(failure.message) }
    finally { if (mounted.current && sequence.current === id) { locked.current = false; setBusy(false) } }
  }
  return <section className="bot-mentor-card" aria-label="Chess coach">
    <div className="bot-mentor-top"><div className="bot-mentor-portrait"><StrawHatEmblem /></div><div><span>YOUR FIRST MATE</span><h2>The ship's mentor</h2><p>One useful idea. Then your move.</p></div><Sparkles className="bot-sparkle" size={22} /></div>
    <div className="bot-mentor-options"><label>Teaching style<select value={style} onChange={event => onStyle?.(event.target.value)}><option value="cheeky">Cheeky first mate</option><option value="patient">Patient teacher</option></select></label><label>Language<select value={language} onChange={event => onLanguage?.(event.target.value)}><option value="en">English</option><option value="ru">Русский</option></select></label></div>
    {(coach || (coachThinking && !coachSilentCheck)) && <div className="bot-coach-bubble" aria-live="polite">{coachThinking ? <><span className="bot-coach-source">CHECKING ONE IDEA</span><p>Studying the position...</p></> : <><span className="bot-coach-source">{coach.source === 'openai' ? 'AI MENTOR' : 'ENGINE TIP'} · {coach.kind === 'hint' ? 'YOUR NEXT IDEA' : 'LAST TURN'}</span><p>{coach.text}</p>{coach.lesson?.fen === fen && <button onClick={() => onHighlight?.(coach.lesson)}>Highlight the idea</button>}</>}</div>}
    {coachError && <p className="bot-error" role="alert">{coachError}</p>}
    {onHint && <div className="bot-coach-actions"><button disabled={!canHint || coachThinking || busy} onClick={onHint}><Lightbulb size={16} /> Hint, please</button><button disabled={!canReview || coachThinking || busy} onClick={onReview}>Explain last turn</button></div>}
    {onAutoCoach && <label className="bot-auto-coach"><input type="checkbox" checked={autoCoach} onChange={event => onAutoCoach(event.target.checked)} /> Only point out important moments</label>}
    <div className="mentor-tabs" role="tablist" aria-label="Coach mode"><button role="tab" aria-selected={tab === 'engine'} onClick={() => { setTab('engine'); setError('') }}><Bot size={15} /> Engine chat</button><button role="tab" aria-selected={tab === 'ai'} onClick={() => { setTab('ai'); setError('') }}><MessageCircle size={15} /> AI chat</button></div>
    {tab === 'engine' ? <div role="tabpanel" aria-label="Engine chat">
      <p className="bot-save-note">Position analysis and threat cards. No AI request needed.</p>
      <div className="mentor-engine-actions">{[['best', 'Best move'], ['threats', 'Threats'], ['review', 'Review my move'], ['analyze', 'Analyze position']].map(([action, label]) => <button key={action} disabled={busy || (action === 'review' && !game.history({ verbose: true }).some(move => move.color === playerColor))} onClick={() => engine(action)}>{label}</button>)}</div>
      <div ref={messageList} className="mentor-messages" aria-live="polite">{!cards.length && <p className="mentor-empty">Ask for a threat check or a move idea when you need one.</p>}{cards.map(item => <article className="mentor-engine-card" key={item.id}><small>STOCKFISH · {item.action.toUpperCase()}</small><h3>{item.card?.title ?? 'Position checked'}</h3><p>{item.text}</p>{item.line?.length > 0 && item.action !== 'threats' && <details><summary>Show short line</summary><p>{item.line.join(' → ')}</p></details>}{item.card?.squares.length > 0 && <button disabled={item.card.fen !== fen} onClick={() => onHighlight?.(item.card)}>{item.card.fen === fen ? 'Highlight on board' : 'Earlier position'}</button>}</article>)}</div>
    </div> : <div role="tabpanel" aria-label="AI chat">
      <p className="bot-save-note">Ask about the position. Your teacher remembers the last few questions in this tab.</p>
      {configured === false && <p className="bot-save-note">AI chat is not connected yet. Engine chat still works.</p>}
      <div ref={messageList} className="mentor-messages" aria-live="polite">{!messages.length && <p className="mentor-empty">“Why is my bishop stuck?” or “What is the bot threatening?”</p>}{messages.map((item, index) => <article key={index} className={`mentor-message ${item.role}`}><small>{item.role === 'user' ? 'YOU' : 'AI TEACHER'}{item.fen !== fen ? ' · EARLIER POSITION' : ''}</small><p>{item.content}</p></article>)}</div>
      <form className="mentor-ask" onSubmit={ask}><label className="sr-only" htmlFor="mentor-question">Ask your chess teacher</label><textarea id="mentor-question" value={draft} onChange={event => setDraft(event.target.value)} maxLength={800} placeholder="Ask one chess question..." rows={2} disabled={busy} /><button disabled={busy || !draft.trim() || configured === false} type="submit"><Send size={15} /> Ask teacher</button></form>
      <button className="mentor-clear" disabled={busy || !messages.length} onClick={() => setMessages([])}><Trash2 size={13} /> Clear conversation</button>
    </div>}
    {busy && <p className="bot-save-note" role="status">{tab === 'ai' ? 'Your teacher is considering your question...' : 'Stockfish is checking the position...'}</p>}
    {error && <p className="bot-error" role="alert">{error}</p>}
    <p className="bot-mentor-footnote">AI explanations can be imperfect. Use the highlighted position to check them.</p>
  </section>
}
