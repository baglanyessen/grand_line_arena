import { useEffect, useRef, useState } from 'react'
import { Swords } from 'lucide-react'
import useRemotePage from '../hooks/useRemotePage'
import api from '../lib/api'
import WarRoster from './WarRoster'

const button = 'px-4 py-2 rounded-lg border border-wanted-border/30 text-sepia text-sm disabled:opacity-40'
const formatDate = value => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function Pages({ page, setPage, hasMore, loading }) {
  return <nav aria-label="War pages" className="flex items-center justify-center gap-4 text-sm text-sepia">
    <button className={button} disabled={!page || loading} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1}</span>
    <button className={button} disabled={!hasMore || loading || page >= 500} onClick={() => setPage(page + 1)}>Next</button>
  </nav>
}

export default function CrewWarsTab({ crew, myRole, onJoinWarMatch }) {
  if (!crew) return <div className="ships-log rounded-xl p-6 text-center text-sepia"><Swords className="mx-auto mb-3" /><h3 className="font-display font-bold">Join a crew first</h3><p className="text-sm mt-2">Your crew's war requests and battles will appear here.</p></div>
  return <WarBoard key={crew.id} crew={crew} myRole={myRole} onJoinWarMatch={onJoinWarMatch} />
}

function WarBoard({ crew, myRole, onJoinWarMatch }) {
  const [status, setStatus] = useState('all'), [page, setPage] = useState(0)
  const [showDeclare, setShowDeclare] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef(false)
  const request = useRemotePage(`/wars/?status=${status}&limit=20&offset=${page * 20}`)
  const act = async () => {
    if (pending.current || !confirmation) return
    pending.current = true; setBusy(true); setError('')
    try {
      await api.post(`/wars/${confirmation.id}/${confirmation.action}`)
      setConfirmation(null); request.refresh()
    } catch (failure) { setError(failure.message); setConfirmation(null); request.refresh() }
    finally { pending.current = false; setBusy(false) }
  }
  return <div className="flex flex-col gap-4 text-sepia">
    <div className="flex flex-wrap justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {['all', 'pending', 'active', 'history'].map(value => <button key={value} disabled={busy} aria-pressed={status === value} className={`${button} ${status === value ? 'bg-tavern-wood text-parchment' : ''}`} onClick={() => { setStatus(value); setPage(0); setConfirmation(null) }}>{value === 'all' ? 'All wars' : value === 'pending' ? 'Requests' : value === 'active' ? 'Active' : 'History'}</button>)}
      </div>
    </div>
    {myRole === 'captain' && <button className={`${button} w-fit bg-stamp-red text-parchment`} disabled={busy} onClick={() => setShowDeclare(!showDeclare)}><Swords size={15} className="inline mr-2" />{showDeclare ? 'Close request form' : 'Challenge a crew'}</button>}
    {showDeclare && myRole === 'captain' && <DeclareWarForm crewId={crew.id} onDeclared={() => { setShowDeclare(false); setStatus('all'); setPage(0); request.refresh() }} />}
    {(error || request.error) && <div role="alert" className="ships-log rounded-xl p-4 text-stamp-red"><p>{error || request.error}</p>{request.error && <button className="underline mt-2" onClick={request.refresh}>Try again</button>}</div>}
    {request.loading && <p role="status" className="p-6 text-center">Checking the fleet's dispatches...</p>}
    {!request.loading && !request.error && !request.data?.wars.length && <div className="ships-log rounded-xl p-6 text-center"><h3 className="font-display font-bold">{page ? 'No more wars on this page' : 'No wars in this view'}</h3><p className="text-sm mt-2">Incoming challenges and your crew's requests will appear here.</p></div>}
    {request.data?.wars.map(war => {
      const outgoing = war.challengerCrewId === crew.id
      const opponent = outgoing ? war.defenderName : war.challengerName
      const tag = outgoing ? war.defenderTag : war.challengerTag
      const selected = confirmation?.id === war.id
      return <article key={war.id} className="ships-log rounded-xl p-5">
        <div className="flex flex-wrap justify-between gap-3"><div><span className="text-xs uppercase tracking-wide text-sepia-light">{outgoing ? 'Outgoing challenge' : 'Incoming challenge'}</span><h3 className="font-display font-bold text-lg break-words mt-1">vs {opponent} <span className="text-sm text-sepia-light">#{tag}</span></h3></div><strong className="text-xs uppercase rounded-lg bg-parchment-dark/40 px-3 py-2 h-fit">{war.status === 'cancelled' ? 'Closed' : war.status}</strong></div>
        <p className="text-sm mt-3">{war.matchesPerSide} fighters per side</p><p className="text-xs text-sepia-light mt-1">Sent {formatDate(war.startedAt)}{war.endedAt ? ` · Ended ${formatDate(war.endedAt)}` : ''}</p>
        <p className="font-display font-bold text-lg mt-3">{war.challengerName} {war.challengerScoreHalf / 2} : {war.defenderScoreHalf / 2} {war.defenderName}</p>
        {war.bonusStatus && <p className="text-sm mt-2">{war.bonusStatus === 'forfeit' ? 'No war bonus: the war included a technical outcome.' : war.bonusStatus === 'short_games' ? 'No war bonus: at least one board had fewer than 4 half-moves.' : war.bonusStatus === 'pair_limit' ? 'No war bonus: this crew pair has already earned its daily bonus.' : war.winnerCrewId ? 'Winning fighters receive up to +200 bounty each.' : 'Draw: all fighters receive up to +100 bounty each.'}</p>}
        {war.status === 'pending' && <p className="text-xs text-sepia-light mt-2">Respond by {formatDate(war.requestDeadline)}</p>}
        {war.status === 'active' && !war.boardsCreated && war.rosterDeadline && <p className="text-xs text-sepia-light mt-2">Submit rosters by {formatDate(war.rosterDeadline)}</p>}
        {war.endReason && <p className="text-sm mt-2">{{ request_expired: 'Request expired without a response.', roster_timeout: 'Roster deadline passed. A crew with a full roster wins by forfeit; otherwise the war is cancelled.', board_forfeit: 'War completed with technical board results.' }[war.endReason] ?? ''}</p>}
        {war.status === 'pending' && <p className="text-sm mt-3">{outgoing ? 'Waiting for the rival captain to respond.' : 'Your captain can accept or decline this challenge.'}</p>}
        {['active', 'completed'].includes(war.status) && <WarRoster warId={war.id} myRole={myRole} onJoinWarMatch={onJoinWarMatch} />}
        {war.status === 'completed' && <p className="text-sm mt-3">{war.winnerCrewId ? war.winnerCrewId === crew.id ? 'Your crew won this war.' : 'The rival crew won this war.' : war.bonusStatus ? 'The war ended in a draw.' : 'No winner recorded.'}</p>}
        {war.status === 'cancelled' && <p className="text-sm mt-3">This request is closed. Either crew can issue a new challenge.</p>}
        {war.status === 'pending' && myRole === 'captain' && !selected && <div className="flex flex-wrap gap-2 mt-4">
          {(outgoing ? ['cancel'] : ['accept', 'decline']).map(action => <button key={action} disabled={busy} className={button} onClick={() => { setError(''); setConfirmation({ id: war.id, action, opponent }) }}>{action === 'cancel' ? 'Withdraw request' : action === 'accept' ? 'Accept challenge' : 'Decline challenge'}</button>)}
        </div>}
        {selected && <div className="mt-4 p-4 rounded-lg bg-parchment-dark/30" role="group" aria-label="Confirm war action"><p className="text-sm">{confirmation.action === 'accept' ? `Accept the war against ${confirmation.opponent}? An active war blocks crew disbanding.` : `Close the challenge against ${confirmation.opponent}? No war will begin from this request.`}</p><div className="flex gap-2 mt-3"><button className={button} disabled={busy} onClick={act}>{busy ? 'Saving...' : 'Confirm'}</button><button className={button} disabled={busy} onClick={() => setConfirmation(null)}>Back</button></div></div>}
      </article>
    })}
    <Pages page={page} setPage={value => { setPage(value); setConfirmation(null) }} hasMore={request.data?.hasMore} loading={request.loading || busy} />
    <p className="text-xs text-sepia-light">Each stage has a 24-hour deadline. Technical outcomes award no war bonus. New requests and rival captain responses update automatically. Only pending requests can be withdrawn or declined.</p>
  </div>
}

function DeclareWarForm({ crewId, onDeclared }) {
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const [targetCrewId, setTargetCrewId] = useState(''), [matchesPerSide, setMatchesPerSide] = useState(5)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const pending = useRef(false)
  const request = useRemotePage(`/crews/?search=${encodeURIComponent(query)}&limit=20&offset=${page * 20}`)
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(0); setTargetCrewId('') }, 300); return () => clearTimeout(timer) }, [search])
  const candidates = request.data?.crews.filter(crew => crew.id !== crewId) ?? []
  return <form className="ships-log rounded-xl p-5 flex flex-col gap-3" onSubmit={async event => {
    event.preventDefault(); if (pending.current) return
    pending.current = true; setLoading(true); setError('')
    try { await api.post('/wars', { defenderCrewId: targetCrewId, matchesPerSide }); onDeclared() }
    catch (failure) { setError(failure.message) }
    finally { pending.current = false; setLoading(false) }
  }}>
    <h3 className="font-display font-bold">Send a war challenge</h3>
    {(error || request.error) && <p role="alert" className="text-sm text-stamp-red">{error || request.error}{request.error && <button type="button" onClick={request.refresh} className="block underline">Retry crew search</button>}</p>}
    <label className="text-sm">Find a crew<input value={search} onChange={event => setSearch(event.target.value)} maxLength={64} disabled={loading} placeholder="Crew name..." className="block w-full p-2 mt-1 rounded border border-wanted-border/30" /></label>
    <label className="text-sm">Rival crew<select required disabled={loading || request.loading} value={targetCrewId} onChange={event => setTargetCrewId(event.target.value)} className="block w-full p-2 mt-1 rounded border border-wanted-border/30"><option value="">{request.loading ? 'Loading crews...' : candidates.length ? 'Select a rival crew' : 'No rival crews on this page'}</option>{candidates.map(crew => <option key={crew.id} value={crew.id}>{crew.name} (#{crew.tag})</option>)}</select></label>
    <div className="flex gap-3 text-xs"><button type="button" disabled={!page || request.loading || loading} onClick={() => { setPage(page - 1); setTargetCrewId('') }}>Previous crews</button><span>Page {page + 1}</span><button type="button" disabled={!request.data?.hasMore || page >= 500 || request.loading || loading} onClick={() => { setPage(page + 1); setTargetCrewId('') }}>Next crews</button></div>
    <label className="text-sm">Fighters per side<input type="number" required min={1} max={15} step={1} value={matchesPerSide} disabled={loading} onChange={event => setMatchesPerSide(Number(event.target.value))} className="block w-full max-w-xs p-2 mt-1 rounded border border-wanted-border/30" /></label>
    <button className={`${button} bg-stamp-red text-parchment w-fit`} type="submit" disabled={loading || request.loading || !targetCrewId}>{loading ? 'Sending...' : 'Send challenge'}</button>
  </form>
}
