import LeadershipPanel from './LeadershipPanel'
import { useState, useEffect, useRef } from 'react'
import { Users, Crown, Swords, Shield, Plus, Search, LogOut, Trash2, Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import useRemotePage from '../hooks/useRemotePage'
import CrewWarsTab from './CrewWars'

/**
 * CrewPage — Crew system with real API integration
 */
export default function CrewPage({ onJoinWarMatch, initialTab = 'my-crew' }) {
  const { user } = useAuth()
  const [tab, setTab] = useState(initialTab)
  const mine = useRemotePage('/crews/mine')
  const myCrew = mine.data?.crew ?? null
  const myMembers = mine.data?.members ?? []
  const myRole = mine.data?.myRole ?? null
  const loadingMyCrew = mine.loading
  const loadMyCrew = mine.refresh

  const tabs = [
    { id: 'my-crew', label: 'My Crew', icon: Shield },
    { id: 'find', label: 'Find Crew', icon: Search },
    { id: 'wars', label: 'Crew Wars', icon: Swords },
    { id: 'leadership', label: "Captain's challenge", icon: Crown },
  ]

  return (
    <div className="h-full flex flex-col p-6 max-w-5xl mx-auto w-full">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-pirate text-3xl text-sepia">Crew</h2>
          <p className="font-body text-sm text-sepia-light mt-1">
            Join a crew. Wage war. Conquer the Grand Line.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-parchment-dark/40 rounded-xl p-1 mb-6 w-fit border border-wanted-border/20">
        {tabs.map((t) => {
          const Icon = t.icon
          const isActive = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg font-display text-sm font-semibold
                transition-all duration-200 cursor-pointer
                ${isActive
                  ? 'bg-tavern-wood text-parchment shadow-md'
                  : 'text-sepia hover:bg-parchment-dark/60'
                }
              `}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {mine.error && <div role="alert" className="ships-log rounded-xl p-4 mb-4 text-stamp-red"><p>{mine.error}</p><button onClick={loadMyCrew} className="mt-2 underline">Retry crew lookup</button></div>}
        {tab === 'my-crew' && !mine.error && (
          <MyCrewTab
            crew={myCrew}
            members={myMembers}
            myRole={myRole}
            loading={loadingMyCrew}
            userId={user.id}
            onRefresh={loadMyCrew}
            onSwitchTab={setTab}
          />
        )}
        {tab === 'find' && <FindCrewTab onJoined={() => { loadMyCrew(); setTab('my-crew') }} hasCrew={loadingMyCrew || !!mine.error || !!myCrew} />}
        {tab === 'wars' && <CrewWarsTab crew={myCrew} myRole={myRole} onJoinWarMatch={onJoinWarMatch} />}
        {tab === 'leadership' && <LeadershipPanel crew={myCrew} myRole={myRole} onJoinMatch={id => onJoinWarMatch(id, 'leadership')} />}
      </div>
    </div>
  )
}

/* ─── My Crew Tab ──────────────────────────────────────── */
function MyCrewTab({ crew, members, myRole, loading, userId, onRefresh, onSwitchTab }) {
  const [showCreate, setShowCreate] = useState(false)
  const [transferTarget, setTransferTarget] = useState(null)
  const [disbandOpen, setDisbandOpen] = useState(false)
  const [disbandTag, setDisbandTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const actionPending = useRef(false)
  const runAction = async action => {
    if (actionPending.current) return
    actionPending.current = true
    setBusy(true); setActionError('')
    try {
      await action()
      setTransferTarget(null)
      setDisbandOpen(false); setDisbandTag('')
      onRefresh()
    } catch (error) { setActionError(error.message) }
    finally { actionPending.current = false; setBusy(false) }
  }

  if (loading) {
    return (
      <div className="ships-log rounded-xl p-6 h-64 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-sepia animate-spin" />
      </div>
    )
  }

  if (!crew) {
    return showCreate ? (
      <CreateCrewForm onCreated={onRefresh} onCancel={() => setShowCreate(false)} />
    ) : (
      <div className="ships-log rounded-xl p-6 flex flex-col items-center justify-center text-center" style={{ minHeight: 300 }}>
        <div className="w-20 h-20 rounded-full bg-parchment-dark/50 flex items-center justify-center mb-4">
          <Users className="w-10 h-10 text-sepia-light/40" />
        </div>
        <h3 className="font-display text-lg font-bold text-sepia mb-2">No Crew Yet</h3>
        <p className="font-body text-sm text-sepia-light max-w-xs mb-6">
          You're sailing solo, Captain. Create a crew or join one to participate in Crew Wars.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-stamp-red text-parchment font-display font-bold text-sm tracking-wider uppercase shadow-button hover:bg-stamp-red-dark transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Create Crew
          </button>
          <button
            onClick={() => onSwitchTab('find')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-parchment-dark/50 text-sepia border border-wanted-border/30 font-display font-bold text-sm tracking-wider uppercase hover:bg-parchment-dark transition-colors cursor-pointer"
          >
            <Search className="w-4 h-4" />
            Browse Crews
          </button>
        </div>
      </div>
    )
  }

  // Show crew details
  return (
    <div className="flex flex-col gap-4">
      {actionError && <div role="alert" className="ships-log rounded-xl p-4 text-stamp-red">{actionError}</div>}
      {disbandOpen && myRole === 'captain' && <section aria-label="Confirm crew disbanding" className="ships-log rounded-xl p-5 border-2 border-stamp-red">
        <h4 className="font-display font-bold text-stamp-red">Lower the flag of {crew.name}?</h4>
        <p className="text-sm text-sepia mt-2">All {members.length} members, including you, will leave the crew. Player bounty and past battles are preserved. The crew name and tag remain reserved in the archives. This cannot be undone.</p>
        <p className="text-xs text-sepia-light mt-2">Pending and active wars must be resolved first.</p>
        <label className="block text-sm text-sepia mt-4">Type the crew tag <strong>{crew.tag}</strong> to confirm.
          <input value={disbandTag} onChange={event => setDisbandTag(event.target.value)} disabled={busy} autoComplete="off" className="block w-full max-w-xs mt-2 p-2 rounded border border-wanted-border/40" />
        </label>
        <div className="flex flex-wrap gap-3 mt-4">
          <button disabled={busy || disbandTag !== crew.tag} onClick={() => runAction(() => api.post(`/crews/${crew.id}/disband`))} className="px-4 py-2 rounded-lg bg-stamp-red text-parchment text-sm disabled:opacity-40">{busy ? 'Disbanding...' : 'Disband crew permanently'}</button>
          <button disabled={busy} onClick={() => { setDisbandOpen(false); setDisbandTag('') }} className="px-4 py-2 rounded-lg border text-sepia text-sm">Cancel</button>
        </div>
      </section>}
      {transferTarget && myRole === 'captain' && <section aria-label="Confirm captain transfer" className="ships-log rounded-xl p-5 border-2 border-gold-dark">
        <h4 className="font-display font-bold text-sepia">Pass the captain's hat?</h4>
        <p className="text-sm text-sepia mt-2"><strong>{transferTarget.username}</strong> will become captain. You will become an officer and lose captain permissions.</p>
        <div className="flex flex-wrap gap-3 mt-4">
          <button disabled={busy} onClick={() => runAction(() => api.post(`/crews/${crew.id}/transfer`, { userId: transferTarget.userId }))} className="px-4 py-2 rounded-lg bg-stamp-red text-parchment text-sm disabled:opacity-40">{busy ? 'Transferring...' : 'Confirm transfer'}</button>
          <button disabled={busy} onClick={() => setTransferTarget(null)} className="px-4 py-2 rounded-lg border text-sepia text-sm">Cancel</button>
        </div>
      </section>}
      {/* Crew header */}
      <div className="ships-log rounded-xl p-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-xl bg-tavern-wood flex items-center justify-center shadow-lg">
            <Crown className="w-8 h-8 text-parchment" />
          </div>
          <div>
            <h3 className="font-display text-xl font-bold text-sepia">{crew.name}</h3>
            <p className="font-body text-sm text-sepia-light">#{crew.tag} · {members.length}/{crew.maxMembers} members</p>
            <p className="font-body text-sm text-sepia-light">Crew bounty: ฿ {crew.totalBounty.toLocaleString()}</p>
            {crew.description && (
              <p className="font-body text-xs text-sepia-light/70 mt-1">{crew.description}</p>
            )}
          </div>
        </div>

        {myRole !== 'captain' && (
          <button
            disabled={busy}
            onClick={() => runAction(() => api.post(`/crews/${crew.id}/leave`))}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-stamp-red/10 text-stamp-red border border-stamp-red/20 font-display text-xs font-semibold uppercase hover:bg-stamp-red/20 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Leave Crew
          </button>
        )}
        {myRole === 'captain' && <button disabled={busy} onClick={() => { setTransferTarget(null); setActionError(''); setDisbandTag(''); setDisbandOpen(true) }} className="px-4 py-2 rounded-lg border border-stamp-red/40 text-stamp-red text-xs disabled:opacity-40">Disband crew</button>}
      </div>

      {/* Members list */}
      <div className="flex flex-col gap-1">
        <h4 className="font-display text-xs font-bold text-sepia tracking-widest uppercase px-1 mb-2">
          Members
        </h4>
        {members.map((member) => (
          <div key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-parchment-dark/15 hover:bg-parchment-dark/30 transition-colors">
            <div className="w-9 h-9 rounded-full bg-tavern-wood/80 flex items-center justify-center shadow-md flex-shrink-0">
              <span className="font-display font-bold text-parchment text-sm">
                {member.username?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-display font-bold text-sepia text-sm">{member.username}</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-body text-xs text-sepia-light">Bounty: {member.bounty.toLocaleString()}</span>
                <span className={`font-display text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  member.role === 'captain' ? 'bg-gold-dark/20 text-gold-dark' :
                  member.role === 'officer' ? 'bg-ocean-teal/20 text-ocean-teal' :
                  'bg-parchment-dark/30 text-sepia-light'
                }`}>
                  {member.role}
                </span>
              </div>
            </div>
            {myRole === 'captain' && member.userId !== userId && member.role !== 'captain' && <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => runAction(() => api.put(`/crews/${crew.id}/members/${member.userId}/role`, { role: member.role === 'officer' ? 'member' : 'officer' }))} className="px-3 py-2 rounded-lg border border-wanted-border/30 text-xs text-sepia disabled:opacity-40" aria-label={`${member.role === 'officer' ? 'Demote' : 'Promote'} ${member.username}`}>
                {member.role === 'officer' ? 'Make member' : 'Make officer'}
              </button>
              <button disabled={busy} onClick={() => { setActionError(''); setDisbandOpen(false); setTransferTarget(member) }} className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gold-dark/40 text-xs text-sepia disabled:opacity-40" aria-label={`Transfer captaincy to ${member.username}`}><Crown size={13} /> Make captain</button>
            </div>}
            {(myRole === 'captain' || (myRole === 'officer' && member.role === 'member')) && member.userId !== userId && member.role !== 'captain' && (
              <button
                disabled={busy}
                onClick={() => runAction(() => api.delete(`/crews/${crew.id}/members/${member.userId}`))}
                className="p-2 rounded-lg text-sepia-light/40 hover:text-stamp-red hover:bg-stamp-red/10 transition-colors cursor-pointer"
                title="Kick member"
                aria-label={`Kick ${member.username}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Create Crew Form ─────────────────────────────────── */
function CreateCrewForm({ onCreated, onCancel }) {
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.post('/crews', { name, tag, description })
      onCreated()
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="ships-log rounded-xl p-6 max-w-md mx-auto">
      <h3 className="font-display text-lg font-bold text-sepia mb-4">Create Your Crew</h3>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-stamp-red/10 border border-stamp-red/20 text-stamp-red font-body text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block font-display text-xs font-bold text-sepia tracking-wider uppercase mb-1.5">
            Crew Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Straw Hat Pirates"
            required
            minLength={3}
            maxLength={64}
            className="w-full px-4 py-3 rounded-xl bg-parchment-dark/20 border border-wanted-border/20 font-body text-sm text-sepia placeholder:text-sepia-light/40 outline-none focus:border-tavern-wood transition-all"
          />
        </div>
        <div>
          <label className="block font-display text-xs font-bold text-sepia tracking-wider uppercase mb-1.5">
            Tag
          </label>
          <input
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value.toUpperCase())}
            placeholder="SHP"
            required
            minLength={2}
            maxLength={10}
            className="w-full px-4 py-3 rounded-xl bg-parchment-dark/20 border border-wanted-border/20 font-body text-sm text-sepia placeholder:text-sepia-light/40 outline-none focus:border-tavern-wood transition-all"
          />
        </div>
        <div>
          <label className="block font-display text-xs font-bold text-sepia tracking-wider uppercase mb-1.5">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Our crew will become the Pirate King's fleet!"
            maxLength={500}
            rows={3}
            className="w-full px-4 py-3 rounded-xl bg-parchment-dark/20 border border-wanted-border/20 font-body text-sm text-sepia placeholder:text-sepia-light/40 outline-none focus:border-tavern-wood transition-all resize-none"
          />
        </div>
        <div className="flex gap-3 mt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-stamp-red text-parchment font-display font-bold text-sm tracking-wider uppercase shadow-button hover:bg-stamp-red-dark transition-colors cursor-pointer disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-3 rounded-xl bg-parchment-dark/50 text-sepia border border-wanted-border/30 font-display font-bold text-sm tracking-wider uppercase hover:bg-parchment-dark transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

/* ─── Find Crew Tab ────────────────────────────────────── */
function FindCrewTab({ onJoined, hasCrew }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [joining, setJoining] = useState(null)
  const [joinError, setJoinError] = useState('')
  const request = useRemotePage(`/crews/?search=${encodeURIComponent(query)}&limit=20&offset=${page * 20}`)
  const crews = request.data?.crews ?? []
  const loading = request.loading
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setPage(0) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <div className="flex flex-col gap-4">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-parchment-dark/30 border border-wanted-border/20">
        <Search className="w-4 h-4 text-sepia-light" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search crews by name..."
          className="bg-transparent outline-none font-body text-sm text-sepia placeholder:text-sepia-light/50 w-full"
        />
      </div>

      {(request.error || joinError) && <div role="alert" className="ships-log rounded-xl p-4 text-stamp-red"><p>{request.error || joinError}</p>{request.error && <button onClick={request.refresh} className="mt-2 underline">Try again</button>}</div>}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-sepia animate-spin" />
        </div>
      ) : request.error ? null : crews.length === 0 ? (
        <div className="ships-log rounded-xl p-6 text-center">
          <p className="font-body text-sm text-sepia-light">No crews found. Be the first to create one!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {crews.map((crew) => (
            <div
              key={crew.id}
              className="flex items-center gap-4 px-5 py-4 rounded-xl bg-parchment-dark/20 border border-wanted-border/15 hover:bg-parchment-dark/40 transition-colors"
            >
              <div className="w-12 h-12 rounded-xl bg-tavern-wood flex items-center justify-center shadow-md flex-shrink-0">
                <Crown className="w-6 h-6 text-parchment" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display font-bold text-sepia text-sm">{crew.name}</span>
                  <span className="font-body text-xs text-sepia-light/60">#{crew.tag}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="font-body text-xs text-sepia-light">
                    <Users className="w-3 h-3 inline mr-1" />{crew.memberCount || 0}/{crew.maxMembers} members
                  </span>
                </div>
              </div>
              {!hasCrew && (
                <button
                  disabled={!!joining || crew.memberCount >= crew.maxMembers}
                  onClick={async () => {
                    setJoining(crew.id); setJoinError('')
                    try {
                      await api.post(`/crews/${crew.id}/join`)
                      onJoined()
                    } catch (err) { setJoinError(err.message); request.refresh() }
                    finally { setJoining(null) }
                  }}
                  className="px-4 py-1.5 rounded-lg bg-ocean-teal/10 text-ocean-teal border border-ocean-teal/20 font-display text-xs font-semibold uppercase hover:bg-ocean-teal/20 transition-colors cursor-pointer"
                >
                  {joining === crew.id ? 'Joining...' : crew.memberCount >= crew.maxMembers ? 'Full' : 'Join'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <nav aria-label="Crew pages" className="flex justify-center items-center gap-4 mt-3 text-sm text-sepia">
        <button disabled={!page || loading} onClick={() => setPage(page - 1)} className="px-3 py-2 border rounded-lg disabled:opacity-40">Previous</button>
        <span>Page {page + 1}</span>
        <button disabled={!request.data?.hasMore || loading || page >= 500} onClick={() => setPage(page + 1)} className="px-3 py-2 border rounded-lg disabled:opacity-40">Next</button>
      </nav>
    </div>
  )
}

/* ─── Crew Wars Tab ────────────────────────────────────── */
