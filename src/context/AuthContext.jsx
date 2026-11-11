import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import api from '../lib/api'
import { mergeBountyProfile } from '../lib/bounty'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('gla_token'))
  const [loading, setLoading] = useState(true)
  const pending = useRef(new Map())
  const [settlements, setSettlements] = useState({})
  const applyBountyProfile = useCallback(profile => {
    setUser(current => mergeBountyProfile(current, profile))
  }, [])
  const trackSettlement = useCallback(gameId => {
    if (!pending.current.has(gameId)) pending.current.set(gameId, Date.now() + 300000)
  }, [])
  const recordSettlement = useCallback((gameId, reward) => {
    pending.current.delete(gameId)
    setSettlements(current => Object.fromEntries([...Object.entries(current), [gameId, reward]].slice(-30)))
  }, [])
  useEffect(() => {
    pending.current.clear()
    setSettlements({})
    if (!token) return
    let cancelled = false, busy = false
    const poll = async () => {
      if (busy) return
      busy = true
      try {
        for (const [id, deadline] of pending.current) {
          if (Date.now() > deadline) { pending.current.delete(id); continue }
          try {
            const data = await api.get(`/games/${id}`)
            if (!cancelled && data.game) recordSettlement(id, data.game.bountyReward)
          } catch { /* Queued results are not yet readable. Retry on the next tick. */ }
        }
        const data = await api.get('/auth/me')
        if (!cancelled) applyBountyProfile(data.user)
      } catch { /* A temporary network failure must not sign the player out. */ }
      finally { busy = false }
    }
    const timer = setInterval(() => { if (pending.current.size) void poll() }, 2000)
    window.addEventListener('focus', poll)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', poll) }
  }, [token, applyBountyProfile, recordSettlement])

  // Load user from stored token on mount
  useEffect(() => {
    let cancelled = false
    if (token) {
      api.get('/auth/me')
        .then((data) => {
          if (!cancelled) setUser(current => current?.id === data.user.id &&
            (current.bountyVersion ?? 0) > (data.user.bountyVersion ?? 0) ? current : data.user)
        })
        .catch(() => {
          if (cancelled) return
          // Token expired or invalid
          localStorage.removeItem('gla_token')
          setToken(null)
          setUser(null)
        })
        .finally(() => { if (!cancelled) setLoading(false) })
    } else {
      setLoading(false)
    }
    return () => { cancelled = true }
  }, [token])

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password })
    localStorage.setItem('gla_token', data.token)
    setToken(data.token)
    setUser(data.user)
    return data.user
  }, [])

  const register = useCallback(async (username, email, password) => {
    const data = await api.post('/auth/register', { username, email, password })
    localStorage.setItem('gla_token', data.token)
    setToken(data.token)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('gla_token')
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, applyBountyProfile, trackSettlement, recordSettlement, settlements }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export default AuthContext
