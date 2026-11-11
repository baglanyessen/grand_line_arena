import { useAuth } from '../context/AuthContext'
import { useRef, useState } from 'react'
import useRemotePage from '../hooks/useRemotePage'
import api from '../lib/api'

const button = 'px-3 py-2 rounded-lg border border-wanted-border/30 text-sm disabled:opacity-40'

export default function WarRoster({ warId, myRole, onJoinWarMatch }) {
  const [open, setOpen] = useState(false)
  return <div className="mt-4">
    <button className={button} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide rosters and pairings' : 'Fighter rosters & pairings'}</button>
    {open && <RosterDetails warId={warId} myRole={myRole} onJoinWarMatch={onJoinWarMatch} />}
  </div>
}

function RosterDetails({ warId, myRole, onJoinWarMatch }) {
  const request = useRemotePage(`/wars/${warId}`)
  const [error, setError] = useState('')
  return <section className="mt-3 p-4 rounded-lg bg-parchment-dark/20" aria-label="War rosters and pairings">
    {request.loading && <p role="status" className="text-sm mt-3">Reading fighter rosters...</p>}
    {(error || request.error) && <p role="alert" className="text-sm text-stamp-red mt-3">{error || request.error}</p>}
    {request.data && <RosterEditor data={request.data} myRole={myRole} onSaved={request.refresh} setError={setError} onJoinWarMatch={onJoinWarMatch} />}
  </section>
}

function RosterEditor({ data, myRole, onSaved, setError, onJoinWarMatch }) {
  const { user } = useAuth()
  const own = data.fighters.filter(fighter => fighter.crewId === data.myCrewId)
  const rival = data.fighters.filter(fighter => fighter.crewId !== data.myCrewId)
  const [selected, setSelected] = useState(() => own.map(fighter => fighter.userId))
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const fixed = data.matches.length > 0, required = data.war.matchesPerSide
  return <div className="flex flex-col gap-4 mt-4">
    {data.settlement && <div className="text-sm"><h4 className="font-bold">War bounty receipt</h4>{data.rewards.filter(reward => reward.crewId === data.myCrewId).map(reward => <p key={reward.userId}>{data.fighters.find(fighter => fighter.userId === reward.userId)?.username}: +{reward.delta.toLocaleString()} bounty</p>)}</div>}
    <div className="grid sm:grid-cols-2 gap-4 text-sm">
      {[['Your crew', own], ['Rival crew', rival]].map(([label, fighters]) => <div key={label}><h4 className="font-bold">{label}: {fighters.length}/{required}</h4>{fighters.length ? <ol className="mt-2 list-decimal pl-5">{fighters.map(fighter => <li key={fighter.userId}>{fighter.username}</li>)}</ol> : <p className="text-sepia-light mt-2">Awaiting selection.</p>}</div>)}
    </div>
    {!fixed && data.war.status === 'active' && myRole === 'captain' && <form onSubmit={async event => {
      event.preventDefault(); if (pending.current) return
      pending.current = true; setSaving(true); setError('')
      try { await api.post(`/wars/${data.war.id}/fighters`, { fighterIds: selected }); onSaved() }
      catch (failure) { setError(failure.message) }
      finally { pending.current = false; setSaving(false) }
    }}>
      <fieldset disabled={saving}><legend className="font-bold text-sm">Choose {required} fighters ({selected.length} selected)</legend>
        <p className="text-xs text-sepia-light my-2">Selection order sets the boards. Uncheck and reselect to reorder. Both submitted rosters create pairings immediately; rosters then lock and assigned fighters must remain in their crew until the war ends.</p>
        <div className="grid sm:grid-cols-2 gap-2 max-h-64 overflow-auto">{data.eligible.map(member => <label key={member.userId} className="flex items-center gap-2 text-sm p-2 rounded bg-parchment-dark/20"><input type="checkbox" checked={selected.includes(member.userId)} disabled={!selected.includes(member.userId) && selected.length >= required} onChange={event => setSelected(current => event.target.checked ? [...current, member.userId] : current.filter(id => id !== member.userId))} />{selected.includes(member.userId) ? `${selected.indexOf(member.userId) + 1}. ` : ''}{member.username}</label>)}</div>
        {data.eligible.length < required && <p className="text-sm text-stamp-red mt-2">Your crew needs more members to fill this roster.</p>}
        <button type="submit" className={`${button} mt-3 bg-tavern-wood text-parchment`} disabled={saving || selected.length !== required}>{saving ? 'Saving...' : own.length ? 'Save roster changes' : 'Submit roster'}</button>
      </fieldset>
    </form>}
    {fixed ? <div><h4 className="font-bold mb-2">Pairings are locked</h4><p className="text-xs text-sepia-light mb-3">Colors alternate by board. Enter your assigned board; the game starts when both players join.</p>{data.matches.map(match => <div key={match.id} className="p-3 border-b border-wanted-border/20 text-sm"><strong>Board {match.boardNumber}</strong><p>Marines (white): {match.whiteName}</p><p>Straw Hats (black): {match.blackName}</p><p>Result: {['both_absent', 'server_interrupted'].includes(match.endReason) ? 'Double forfeit (0:0)' : match.result}</p>{match.endReason && match.endReason !== 'played' && <p>{match.endReason === 'opponent_absent' ? 'Opponent did not enter by the deadline.' : match.endReason === 'server_interrupted' ? 'Both checked in, but no live game or saved result remained at the deadline.' : 'Neither fighter entered by the deadline.'}</p>}{match.result === 'pending' && <p>Enter together by {new Date(match.joinDeadline).toLocaleString()}</p>}{[match.whiteId, match.blackId].includes(user.id) && match.result === 'pending' && <button className={button} onClick={() => onJoinWarMatch(match.id)}>Enter war match</button>}</div>)}</div> : <p className="text-xs text-sepia-light">{data.war.status === 'completed' ? 'The war ended before pairing. No war bonus was awarded.' : 'Pairings appear after both crews submit a full roster. Before pairings, leaving or kicking a fighter removes them from the saved roster.'}</p>}
  </div>
}
