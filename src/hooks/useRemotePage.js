import { useState, useEffect } from 'react'
import api from '../lib/api'

export default function useRemotePage(path, { pollInterval = 10000 } = {}) {
  const [state, setState] = useState({ path: null, data: null, error: '', loading: true })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let cancelled = false, busy = false
    setState({ path, data: null, error: '', loading: true })
    const load = async () => {
      if (cancelled || busy) return
      busy = true
      try {
        const data = await api.get(path)
        if (!cancelled) setState({ path, data, error: '', loading: false })
      } catch (error) {
        if (!cancelled) setState(current => ({ ...current, path, error: error.message, loading: false }))
      } finally { busy = false }
    }
    const updateVisible = () => { if (document.visibilityState === 'visible') void load() }
    void load()
    const timer = pollInterval > 0 ? setInterval(updateVisible, pollInterval) : null
    window.addEventListener('focus', updateVisible)
    document.addEventListener('visibilitychange', updateVisible)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      window.removeEventListener('focus', updateVisible)
      document.removeEventListener('visibilitychange', updateVisible)
    }
  }, [path, revision, pollInterval])
  return { ...(state.path === path ? state : { data: null, error: '', loading: true }),
    refresh: () => setRevision(value => value + 1) }
}
