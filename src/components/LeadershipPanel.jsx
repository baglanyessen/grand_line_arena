import { useRef, useState } from 'react'
import { Crown } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import useRemotePage from '../hooks/useRemotePage'
import api from '../lib/api'

const button = 'px-4 py-2 rounded-lg border border-wanted-border/30 text-sm disabled:opacity-40'
const date = value => new Date(value).toLocaleString()

export default function LeadershipPanel(props) {
  if (!props.crew) return <p className="ships-log p-6 rounded-xl text-sepia">Join a crew to challenge its captain.</p>
  return <ChallengeBoard key={props.crew.id} {...props} />
}

function ChallengeBoard({ crew, myRole, onJoinMatch }) {
  const { user } = useAuth()
  const [page, setPage] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(null)
  const pending = useRef(false)
  const request = useRemotePage(`/leadership/crew/${crew.id}?limit=20&offset=${page * 20}`)
  const rows = request.data?.challenges ?? [], open = rows.some(row => ['pending', 'active'].includes(row.status))
  const act = async () => {
    if (!confirm || pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      await api.post(confirm.action === 'create' ? `/leadership/crew/${crew.id}` : `/leadership/${confirm.id}/${confirm.action}`)
      setConfirm(null); request.refresh()
    } catch (failure) { setError(failure.message); setConfirm(null); request.refresh() }
    finally { pending.current = false; setBusy(false) }
  }
  const name = (challenge, id) => id === challenge.challengerId ? challenge.challengerName : challenge.captainName
  return <div className="flex flex-col gap-4 text-sepia">
    <header className="ships-log rounded-xl p-5"><Crown className="mb-2 text-gold-dark" /><h3 className="font-pirate text-3xl">Who wears the captain's hat?</h3>
      <p className="text-sm mt-3">Up to three games, alternating colors. First to 2 points wins; otherwise the higher score after game three wins. A tied series keeps the current captain. The former captain becomes an officer.</p>
      <p className="text-xs text-sepia-light mt-2">Captain consent required. 24 hours to respond and to enter each round. One open challenge per crew; one request per challenger every 24 hours. Finish crew wars first. Participants, captain transfer and crew disbanding are locked while the challenge is open.</p>
    </header>
    <div className="flex flex-wrap gap-3">
      {myRole !== 'captain' && <button className={`${button} bg-stamp-red text-parchment`} disabled={request.loading || busy || open || page !== 0} onClick={() => setConfirm({ action: 'create' })}>Challenge the captain</button>}
    </div>
    {confirm && <section className="ships-log rounded-xl p-5 border-2 border-wanted-border/30" aria-label="Confirm leadership action"><p className="text-sm">{confirm.action === 'create' ? 'Send a leadership challenge to your captain?' : confirm.action === 'accept' ? 'Accept this series? Losing the series will transfer your captaincy to the challenger.' : 'Close this pending challenge?'}</p><div className="flex gap-3 mt-3"><button disabled={busy} className={button} onClick={act}>{busy ? 'Saving...' : 'Confirm'}</button><button disabled={busy} className={button} onClick={() => setConfirm(null)}>Back</button></div></section>}
    {(error || request.error) && <p className="ships-log rounded-xl p-4 text-stamp-red" role="alert">{error || request.error}{request.error && <button className="block underline" onClick={request.refresh}>Try again</button>}</p>}
    {request.loading && <p role="status" className="p-5 text-center">Reading the captain's log...</p>}
    {!request.loading && !request.error && !rows.length && <p className="ships-log rounded-xl p-5 text-center">No leadership challenges on this page.</p>}
    {rows.map(challenge => <article key={challenge.id} className="ships-log rounded-xl p-5">
      <div className="flex flex-wrap justify-between gap-3"><h3 className="font-display font-bold text-lg">{challenge.challengerName} vs Captain {challenge.captainName}</h3><strong className="uppercase text-xs">{challenge.status}</strong></div>
      <p className="font-bold text-xl mt-3">{challenge.challengerScoreHalf / 2} : {challenge.captainScoreHalf / 2}</p>
      <p className="text-xs text-sepia-light mt-1">Requested {date(challenge.createdAt)}</p>
      {challenge.status === 'pending' && <><p className="text-sm mt-3">Respond by {date(challenge.requestDeadline)}</p><div className="flex flex-wrap gap-2 mt-3">
        {(user.id === challenge.captainId ? ['accept', 'decline'] : user.id === challenge.challengerId ? ['cancel'] : []).map(action => <button key={action} disabled={busy} className={button} onClick={() => setConfirm({ id: challenge.id, action })}>{action === 'accept' ? 'Accept series' : action === 'decline' ? 'Decline request' : 'Withdraw request'}</button>)}
      </div></>}
      {challenge.winnerId && <p className="text-sm mt-3"><strong>{name(challenge, challenge.winnerId)}</strong> {challenge.winnerId === challenge.challengerId ? 'takes the captain’s hat.' : 'keeps the captain’s hat.'}</p>}
      {challenge.endReason && <p className="text-xs text-sepia-light mt-2">{{ captain_holds_tie: 'The captain holds a tied series.', no_contest: 'A round could not start by its deadline; the captain retains leadership.', request_expired: 'The captain did not respond in time.', crew_changed: 'The crew changed; leadership was not transferred.', decline: 'The captain declined.', cancel: 'The challenger withdrew.', series_won: 'Series settled.' }[challenge.endReason]}</p>}
      <div className="flex flex-col gap-3 mt-4">{challenge.matches.map(match => <section key={match.id} className="p-3 rounded-lg bg-parchment-dark/20 text-sm">
        <h4 className="font-bold">Round {match.round}</h4><p>Marines (white): {name(challenge, match.whiteId)}</p><p>Straw Hats (black): {name(challenge, match.blackId)}</p>
        <p className="mt-1">{match.result === 'pending' ? `Enter together by ${date(match.joinDeadline)}` : ['both_absent', 'server_interrupted'].includes(match.endReason) ? 'No contest' : match.result === 'draw' ? 'Draw' : `Winner: ${name(challenge, match.result === 'white' ? match.whiteId : match.blackId)}`}</p>
        {match.endReason && match.endReason !== 'played' && <p className="text-xs mt-1">{match.endReason === 'opponent_absent' ? 'Opponent did not enter.' : match.endReason === 'both_absent' ? 'Neither player entered; series closed.' : 'Round could not start; series closed.'} No match bounty.</p>}
        {challenge.status === 'active' && match.result === 'pending' && [match.whiteId, match.blackId].includes(user.id) && <button className={`${button} mt-3`} disabled={busy} onClick={() => onJoinMatch(match.id)}>Enter leadership match</button>}
      </section>)}</div>
    </article>)}
    <nav className="flex justify-center items-center gap-4 text-sm" aria-label="Leadership pages"><button className={button} disabled={busy || request.loading || !page} onClick={() => { setPage(page - 1); setConfirm(null) }}>Previous</button><span>Page {page + 1}</span><button className={button} disabled={busy || request.loading || !request.data?.hasMore || page >= 500} onClick={() => { setPage(page + 1); setConfirm(null) }}>Next</button></nav>
  </div>
}
