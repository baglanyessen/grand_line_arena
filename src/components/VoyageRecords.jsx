import { useState, useMemo, useEffect, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Trophy, ScrollText, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import useRemotePage from '../hooks/useRemotePage'
import { buildReplay, playerOutcome } from '../lib/gameReplay'
import { onePiecePieces } from './chess/OnePiecePieces'
import './VoyageRecords.css'

const PAGE_SIZE = 20
const berries = value => `฿ ${value.toLocaleString('en-US')}`
const date = value => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function RequestState({ loading, error, refresh }) {
  if (loading) return <p className="records-message" role="status">Reading the ship's log…</p>
  if (error) return <div className="records-message" role="alert"><p>{error}</p><button onClick={refresh}>Try again</button></div>
  return null
}

function Pagination({ page, hasMore, loading, onChange }) {
  return <nav className="records-pagination" aria-label="Pagination">
    <button disabled={!page || loading} onClick={() => onChange(page - 1)}><ChevronLeft size={16} /> Previous</button>
    <span>Page {page + 1}</span>
    <button disabled={!hasMore || loading || page >= 500} onClick={() => onChange(page + 1)}>Next <ChevronRight size={16} /></button>
  </nav>
}

function Replay({ game, userId }) {
  const [ply, setPly] = useState(0)
  const [flipped, setFlipped] = useState(game.blackId === userId)
  const replay = useMemo(() => {
    try { return buildReplay(game.pgn) } catch { return null }
  }, [game.pgn])
  if (!replay) return <p role="alert">This game's PGN could not be replayed.</p>
  const download = () => {
    const url = URL.createObjectURL(new Blob([game.pgn], { type: 'application/x-chess-pgn;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `grand-line-${game.id}.pgn`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <>
    <div className="replay-layout">
      <div className="replay-board"><Chessboard options={{ id: `replay-${game.id}`, position: replay.positions[ply], pieces: onePiecePieces,
        allowDragging: false, boardOrientation: flipped ? 'black' : 'white', animationDurationInMs: 150,
        darkSquareStyle: { backgroundColor: '#4896b4' }, lightSquareStyle: { backgroundColor: '#fff1cf' } }} />
        <div className="replay-controls" aria-label="Replay controls">
          <button aria-label="Starting position" disabled={ply === 0} onClick={() => setPly(0)}><ChevronsLeft size={20} /></button>
          <button aria-label="Previous move" disabled={ply === 0} onClick={() => setPly(ply - 1)}><ChevronLeft size={20} /></button>
          <span aria-live="polite">{ply} / {replay.moves.length}</span>
          <button aria-label="Next move" disabled={ply === replay.moves.length} onClick={() => setPly(ply + 1)}><ChevronRight size={20} /></button>
          <button aria-label="Final position" disabled={ply === replay.moves.length} onClick={() => setPly(replay.moves.length)}><ChevronsRight size={20} /></button>
        </div>
      </div>
      <div className="replay-log"><h3>Battle moves</h3><button aria-pressed={ply === 0} onClick={() => setPly(0)}>Starting position</button>
        <div className="replay-moves">{replay.moves.map((move, index) => <button key={index} aria-pressed={ply === index + 1} onClick={() => setPly(index + 1)}>{move.label}</button>)}</div>
        {!replay.moves.length && <p>No moves were played.</p>}
      </div>
    </div>
    <div className="replay-actions"><button onClick={() => setFlipped(!flipped)}>Flip board</button><button onClick={download}><Download size={16} /> Download PGN</button></div>
  </>
}

function GameDetail({ id, userId, onClose }) {
  const request = useRemotePage(`/games/${id}`, { pollInterval: 0 })
  const game = request.data?.game
  const panel = useRef(null)
  useEffect(() => { panel.current?.scrollIntoView({ block: 'start' }) }, [])
  const reward = game?.bountyReward
  const color = game?.whiteId === userId ? 'white' : 'black'
  return <section ref={panel} className="record-detail" aria-label="Selected match">
    <div className="records-section-heading"><h2>Battle replay</h2><button onClick={onClose} aria-label="Close replay"><X size={20} /></button></div>
    <RequestState {...request} />
    {game && <><p className="replay-players"><strong>{game.whiteName}</strong> <span>Marines vs Straw Hats</span> <strong>{game.blackName}</strong></p>
      <p className="record-caption">{playerOutcome(game, userId)} · {date(game.endedAt)}</p>
      <p className="replay-reward">{reward ? <>
        Your bounty: {reward[`${color}Delta`] > 0 ? '+' : ''}{reward[`${color}Delta`].toLocaleString()} ฿
        <span>Balance after this match: {berries(reward[`${color}After`])}</span>
        {reward.status === 'short_game' && <span>No bounty change: fewer than 4 half-moves.</span>}
        {reward.status === 'pair_limit' && <span>No bounty change: daily opponent limit reached.</span>}
        {reward.status === 'draw' && <span>Draws leave bounty unchanged.</span>}
      </> : 'This match predates bounty records.'}</p>
      <Replay key={game.id} game={game} userId={userId} /></>}
  </section>
}

export function HistoryPage() {
  const { user } = useAuth()
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState(null)
  const request = useRemotePage(`/games/?limit=${PAGE_SIZE + 1}&offset=${page * PAGE_SIZE}`)
  const games = request.data?.games ?? []
  return <div className="records-page">
    <div className="records-heading"><div><p className="eyebrow"><ScrollText size={15} /> YOUR VOYAGE, MOVE BY MOVE</p><h1>The captain's log</h1><p>Every finished battle. Every berry earned.</p></div></div>
    {selected && <GameDetail key={selected} id={selected} userId={user.id} onClose={() => setSelected(null)} />}
    <section className="records-paper" aria-label="Match history"><RequestState {...request} />
      {!request.loading && !request.error && !games.length && <p className="records-message">{page ? 'No more battles on this page.' : 'A clean logbook. Finish an online match to record your first adventure.'}</p>}
      {games.slice(0, PAGE_SIZE).map(game => {
        const white = game.whiteId === user.id, outcome = playerOutcome(game, user.id)
        const delta = game.bountyReward?.[white ? 'whiteDelta' : 'blackDelta']
        return <button key={game.id} className={`history-row${selected === game.id ? ' selected' : ''}`} aria-pressed={selected === game.id} onClick={() => setSelected(game.id)}>
          <span className={`battle-outcome ${outcome?.toLowerCase()}`}>{outcome}</span>
          <span className="history-opponent"><strong>vs {white ? game.blackName : game.whiteName}</strong><small>{white ? 'Marines · White pieces' : 'Straw Hats · Black pieces'}</small></span>
          <time dateTime={game.endedAt}>{date(game.endedAt)}</time>
          <span className="history-delta">{delta == null ? 'No bounty record' : `${delta > 0 ? '+' : ''}${delta.toLocaleString()} ฿`}</span><ChevronRight size={18} />
        </button>
      })}
    </section>
    <Pagination page={page} hasMore={games.length > PAGE_SIZE} loading={request.loading} onChange={setPage} />
    <p className="record-caption">Only your completed online games appear here. Queued results appear automatically after saving.</p>
  </div>
}

export function LeaderboardPage() {
  const { user } = useAuth()
  const [page, setPage] = useState(0)
  const request = useRemotePage(`/players/leaderboard?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`)
  const players = request.data?.players ?? []
  return <div className="records-page">
    <div className="records-heading"><div><p className="eyebrow"><Trophy size={15} /> REPUTATION ACROSS THE SEAS</p><h1>The wanted board</h1><p>The Grand Line's most wanted chess pirates.</p></div></div>
    <div className="bounty-rule-strip"><strong>Make a name for yourself.</strong><span>Win +100 · Loss up to −50 · Draw 0</span><small>Minimum 4 half-moves. Up to 3 rewarded games per opponent per UTC day.</small></div>
    <section className="records-paper" aria-label="Bounty leaderboard"><RequestState {...request} />
      {!request.loading && !request.error && !players.length && <p className="records-message">{page ? 'No more pirates on this page.' : 'The seas are quiet. The first legends have yet to arrive.'}</p>}
      {players.map(player => <article key={player.id} className={`wanted-row${player.id === user?.id ? ' is-you' : ''}`}>
        <span className={`wanted-rank rank-${player.rank}`}>#{player.rank}</span><span className="wanted-initial" aria-hidden="true">{player.username[0]?.toUpperCase()}</span>
        <div className="wanted-name"><strong>{player.username}</strong><small>{player.id === user?.id ? 'YOUR FLAG' : 'WANTED · DEAD OR ALIVE'}</small></div><strong className="wanted-amount">{berries(player.bounty)}</strong>
      </article>)}
    </section>
    <Pagination page={page} hasMore={request.data?.hasMore} loading={request.loading} onChange={setPage} />
    <p className="record-caption">Ordered by bounty, then username for equal balances. Standings update automatically.</p>
  </div>
}
