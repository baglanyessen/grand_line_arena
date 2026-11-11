import { useEffect, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import { Anchor, Bot, Compass, RotateCcw, Flag } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import useBotGame from '../hooks/useBotGame'
import useBoardSize from '../hooks/useBoardSize'
import { needsPromotion } from '../lib/chessState'
import { onePiecePieces } from './chess/OnePiecePieces'
import PromotionDialog from './chess/PromotionDialog'
import ShipsLog from './chess/ShipsLog'
import MentorPanel from './MentorPanel'
import './BotArena.css'

const levels = { rookie: 'East Blue rookie', navigator: 'Grand Line navigator', captain: 'New World captain' }
export default function BotArena() {
  const { user } = useAuth(), bot = useBotGame(user.id), boardSize = Math.min(useBoardSize(), 560)
  const [side, setSide] = useState(bot.playerColor), [level, setLevel] = useState(bot.level), [promotion, setPromotion] = useState(null), [annotation, setAnnotation] = useState(null)
  const game = bot.game, history = game.history({ verbose: true }), last = history.at(-1)
  const finished = bot.resigned || game.isGameOver() || history.length >= 600, myTurn = !finished && game.turn() === bot.playerColor
  useEffect(() => { setPromotion(null); setAnnotation(null) }, [game, bot.resigned])
  const drop = ({ sourceSquare, targetSquare }) => {
    if (!myTurn || promotion || !targetSquare) return false
    if (needsPromotion(game, sourceSquare, targetSquare)) { setPromotion({ from: sourceSquare, to: targetSquare, color: game.turn() }); return false }
    return bot.makeMove(sourceSquare, targetSquare)
  }
  const status = bot.resigned ? 'You resigned. Another voyage awaits.' : game.isCheckmate() ? game.turn() === bot.playerColor ? 'Checkmate. Your mentor has a lesson for next time.' : 'Checkmate. You beat the bot!' : game.isDraw() ? 'A drawn game. Plenty to learn from it.' : history.length >= 600 ? 'Training limit reached. Start another voyage.' : bot.thinking ? 'Your rival is thinking...' : bot.error ? 'The bot needs a moment.' : myTurn ? game.isCheck() ? 'Your king is in check. Find a safe reply.' : 'Your move, Captain.' : 'Waiting for the bot...'
  return <div className="bot-page">
    <header className="bot-heading"><div><p className="eyebrow"><Compass size={14} /> THE CAPTAIN'S DOJO</p><h1>A rival on the board.<br /><span>A first mate by your side.</span></h1><p>Play. Make mistakes. Find out why they matter.</p></div><span className="bot-training-tag"><Anchor size={16} /> TRAINING · NO BOUNTY AT STAKE</span></header>
    <section className="bot-setup" aria-label="Training settings">
      <label>Your side<select value={side} onChange={event => setSide(event.target.value)}><option value="w">Marines · White</option><option value="b">Straw Hats · Black</option></select></label>
      <label>Your rival<select value={level} onChange={event => setLevel(event.target.value)}>{Object.entries(levels).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <button className="bot-primary" onClick={() => { if (!history.length || finished || window.confirm('Start a new training game? This replaces your current training position.')) bot.start(side, level) }}><RotateCcw size={16} /> Start new game</button>
    </section>
    <div className="bot-layout">
      <section className="bot-board-column" aria-label="Training chessboard">
        <div className="bot-opponent"><Bot size={22} /><div><strong>{levels[bot.level]}</strong><small>Stockfish · {bot.playerColor === 'w' ? 'Straw Hats' : 'Marines'}</small></div><span className={bot.thinking ? 'bot-thinking-dot pulsing' : 'bot-thinking-dot'} /></div>
        <div className="bot-board-frame" style={{ width: boardSize + 20 }}><div style={{ width: boardSize, height: boardSize }}><Chessboard options={{
          id: 'TrainingBoard', position: game.fen(), pieces: onePiecePieces, boardOrientation: bot.playerColor === 'w' ? 'white' : 'black',
          onPieceDrop: drop, canDragPiece: ({ piece }) => myTurn && !promotion && piece.pieceType[0] === bot.playerColor,
          animationDurationInMs: 180, darkSquareStyle: { backgroundColor: '#4896b4' }, lightSquareStyle: { backgroundColor: '#fff0c9' },
          squareStyles: annotation?.fen === game.fen() ? Object.fromEntries(annotation.squares.map(square => [square, { backgroundColor: '#eaa45f99' }])) : last ? { [last.from]: { backgroundColor: '#f3cb7099' }, [last.to]: { backgroundColor: '#f3cb7099' } } : {},
          arrows: annotation?.fen === game.fen() ? annotation.arrows : [],
        }} /></div></div>
        <p className="bot-position-status" role="status">{status}</p>
        {bot.error && <p className="bot-error" role="alert">{bot.error} <button onClick={bot.retry}>Retry bot move</button></p>}
        <div className="bot-game-actions"><button disabled={!history.some(move => move.color === bot.playerColor)} onClick={bot.takeBack}><RotateCcw size={15} /> Take back turn</button><button disabled={finished} onClick={bot.resign}><Flag size={15} /> Resign</button></div>
        <p className="bot-save-note">Your position stays in this browser tab when you leave the dojo. Training does not affect multiplayer results or bounty.</p>
      </section>
      <aside className="bot-companion">
        <MentorPanel game={game} playerColor={bot.playerColor} style={bot.style} language={bot.language} onStyle={bot.setStyle} onLanguage={bot.setLanguage}
          configured={bot.configured} coach={bot.coach} coachThinking={bot.coachThinking} coachSilentCheck={bot.coachSilentCheck} coachError={bot.coachError}
          onHint={() => bot.advise('hint')} onReview={() => bot.advise('review')} canHint={myTurn} canReview={history.some(move => move.color === bot.playerColor) && !bot.thinking}
          autoCoach={bot.autoCoach} onAutoCoach={bot.setAutoCoach} onHighlight={setAnnotation} />
        <section className="bot-move-log" aria-label="Training move history"><ShipsLog moveHistory={history} /></section>
      </aside>
    </div>
    {promotion && <PromotionDialog color={promotion.color} onCancel={() => setPromotion(null)} onChoose={piece => { bot.makeMove(promotion.from, promotion.to, piece); setPromotion(null) }} />}
  </div>
}
