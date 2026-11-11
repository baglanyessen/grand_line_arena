import { Swords, Users, LogOut, ArrowUpRight, ScrollText, Trophy } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Bot } from 'lucide-react'
import { GraduationCap } from 'lucide-react'
import { StrawHatEmblem } from './chess/OnePiecePieces'

export default function Sidebar({ activePage, onPageChange, onSignIn }) {
  const { user, logout } = useAuth()
  const items = [{ id: 'play', label: 'Play chess', icon: Swords }, { id: 'bot', label: 'Play with bot', icon: Bot }, { id: 'training', label: 'Training deck', icon: GraduationCap }, { id: 'history', label: "Captain's log", icon: ScrollText }, { id: 'leaderboard', label: 'Wanted board', icon: Trophy }, { id: 'crew', label: 'Crew quarters', icon: Users }]
  return (
    <aside className="main-sidebar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); onPageChange('play') }} aria-label="Grand Line Arena home">
        <span className="brand-icon"><StrawHatEmblem /></span><span>GRAND LINE<span className="brand-subtitle">CHESS & ADVENTURE</span></span>
      </a>
      <p className="nav-caption">YOUR VOYAGE</p>
      <nav className="main-nav" aria-label="Main navigation">
        {items.map(({ id, label, icon: Icon }) => <button key={id} className={activePage === id ? 'nav-item active' : 'nav-item'} aria-current={activePage === id ? 'page' : undefined} onClick={() => onPageChange(id)}><Icon size={19} /><span>{label}</span>{activePage === id && <span className="nav-dot" />}</button>)}
      </nav>
      <div className="sidebar-bottom">
        {user ? <div className="sidebar-account"><span className="account-avatar">{user.username?.[0]?.toUpperCase()}</span><div><strong title={user.username}>{user.username}</strong><small>฿ {(user.bounty ?? 0).toLocaleString()} bounty</small></div><button title="Log out" aria-label="Log out" onClick={() => { logout(); onPageChange('play') }}><LogOut size={17} /></button></div> : <button className="sidebar-signin" onClick={onSignIn}>Log in & set sail <ArrowUpRight size={17} /></button>}
      </div>
    </aside>
  )
}
