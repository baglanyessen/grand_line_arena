import { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Sidebar from './components/Sidebar'
import './components/Adventure.css'
import ChessArena from './components/ChessArena'
import BotArena from './components/BotArena'
import TrainingPage from './components/TrainingPage'
import CrewPage from './components/CrewPage'
import AuthPage from './components/AuthPage'
import { HistoryPage, LeaderboardPage } from './components/VoyageRecords'
import { ArrowLeft, Loader2 } from 'lucide-react'

function AppContent() {
  const { user, loading } = useAuth()
  const [activePage, setActivePage] = useState('play')
  const [authMode, setAuthMode] = useState(null)
  const [destination, setDestination] = useState('play')
  const [warRequest, setWarRequest] = useState(null)
  const [crewTab, setCrewTab] = useState('my-crew')

  function navigate(page, tab = 'my-crew') {
    if (page === 'crew') setCrewTab(tab)
    if (!user && !['play', 'leaderboard'].includes(page)) {
      setDestination(page)
      setAuthMode('register')
      return
    }
    setActivePage(page)
  }

  if (loading) return <div className="app-loading" role="status"><Loader2 className="animate-spin" /><span>Charting your course…</span></div>

  if (!user && authMode) return (
    <div className="auth-screen">
      <button className="back-home" onClick={() => setAuthMode(null)}><ArrowLeft size={16} /> Back to play</button>
      <AuthPage initialMode={authMode} onSuccess={() => { setActivePage(destination); setAuthMode(null) }} />
    </div>
  )

  return (
    <div className="arena-app adventure-theme">
      <Sidebar activePage={activePage} onPageChange={navigate} onSignIn={() => { setDestination('play'); setAuthMode('login') }} />
      <main className="app-main" id="main-content">
        <section hidden={activePage !== 'play'} className="play-page"><div className="page-heading"><p className="eyebrow">MAKE YOUR MOVE</p><h1>The chess arena</h1><p>Marines play white. Straw Hat Pirates play black. The Grand Line is your board.</p></div><ChessArena key={user?.id ?? 'guest'} onSignIn={() => { setDestination('play'); setAuthMode('login') }} isVisible={activePage === 'play'} warRequest={warRequest} onWarRequestHandled={() => setWarRequest(null)} /></section>
        {activePage === 'crew' && user && <div className="crew-page"><CrewPage initialTab={crewTab} onJoinWarMatch={(id, kind = 'war') => { setCrewTab(kind === 'leadership' ? 'leadership' : 'wars'); setWarRequest({ id, kind }); setActivePage('play') }} /></div>}
        {activePage === 'history' && user && <HistoryPage key={user.id} />}
        {activePage === 'bot' && user && <BotArena key={user.id} />}
        {activePage === 'training' && user && <TrainingPage key={user.id} />}
        {activePage === 'leaderboard' && <LeaderboardPage />}
      </main>
    </div>
  )
}

export default function App() {
  return <AuthProvider><AppContent /></AuthProvider>
}
