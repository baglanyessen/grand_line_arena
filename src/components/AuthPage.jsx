import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Skull, Anchor, Eye, EyeOff, Loader2 } from 'lucide-react'

/**
 * AuthPage — Login + Register forms with One Piece parchment styling
 */
export default function AuthPage({ initialMode = 'login', onSuccess }) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState(initialMode)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Form fields
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        if (username.length < 3) {
          setError('Username must be at least 3 characters')
          setLoading(false)
          return
        }
        await register(username, email, password)
      }
      onSuccess?.()
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center p-4">
      {/* Background texture overlay */}
      <div className="fixed inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%233E2F1F\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
        }}
      />

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div className="w-20 h-20 rounded-full bg-tavern-wood flex items-center justify-center shadow-xl">
              <Skull className="w-12 h-12 text-parchment" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-stamp-red flex items-center justify-center shadow-md">
              <Anchor className="w-4 h-4 text-parchment" />
            </div>
          </div>
          <h1 className="font-pirate text-4xl text-sepia tracking-wide">Grand Line Arena</h1>
          <p className="font-body text-sm text-sepia-light mt-1">Where Legends Clash</p>
        </div>

        {/* Card */}
        <div className="ships-log rounded-2xl p-8 shadow-card border border-wanted-border/20">
          {/* Tab toggle */}
          <div className="flex gap-1 bg-parchment-dark/30 rounded-xl p-1 mb-6">
            <button
              onClick={() => { setMode('login'); setError('') }}
              className={`flex-1 py-2.5 rounded-lg font-display text-sm font-semibold transition-all duration-200 cursor-pointer ${
                mode === 'login'
                  ? 'bg-tavern-wood text-parchment shadow-md'
                  : 'text-sepia hover:bg-parchment-dark/50'
              }`}
            >
              Log In
            </button>
            <button
              onClick={() => { setMode('register'); setError('') }}
              className={`flex-1 py-2.5 rounded-lg font-display text-sm font-semibold transition-all duration-200 cursor-pointer ${
                mode === 'register'
                  ? 'bg-tavern-wood text-parchment shadow-md'
                  : 'text-sepia hover:bg-parchment-dark/50'
              }`}
            >
              Register
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-stamp-red/10 border border-stamp-red/20 text-stamp-red font-body text-sm">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === 'register' && (
              <div>
                <label htmlFor="auth-username" className="block font-display text-xs font-bold text-sepia tracking-wider uppercase mb-1.5">
                  Username
                </label>
                <input
                  id="auth-username"
                  autoComplete="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Captain_Luffy"
                  required
                  minLength={3}
                  maxLength={32}
                  className="w-full px-4 py-3 rounded-xl bg-parchment-dark/20 border border-wanted-border/20 font-body text-sm text-sepia placeholder:text-sepia-light/40 outline-none focus:border-tavern-wood focus:ring-1 focus:ring-tavern-wood/30 transition-all"
                />
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block font-display text-xs font-bold text-sepia tracking-wider uppercase mb-1.5">
                Email
              </label>
              <input
                id="auth-email"
                autoComplete="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pirate@grandline.com"
                required
                className="w-full px-4 py-3 rounded-xl bg-parchment-dark/20 border border-wanted-border/20 font-body text-sm text-sepia placeholder:text-sepia-light/40 outline-none focus:border-tavern-wood focus:ring-1 focus:ring-tavern-wood/30 transition-all"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="block font-display text-xs font-bold text-sepia tracking-wider uppercase mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full px-4 py-3 pr-12 rounded-xl bg-parchment-dark/20 border border-wanted-border/20 font-body text-sm text-sepia placeholder:text-sepia-light/40 outline-none focus:border-tavern-wood focus:ring-1 focus:ring-tavern-wood/30 transition-all"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sepia-light hover:text-sepia transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 mt-2 rounded-xl bg-stamp-red text-parchment font-display font-bold text-sm tracking-wider uppercase shadow-button hover:bg-stamp-red-dark hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{mode === 'login' ? 'Logging in...' : 'Creating account...'}</span>
                </>
              ) : (
                <span>{mode === 'login' ? 'Set Sail' : 'Join the Crew'}</span>
              )}
            </button>
          </form>

          {/* Footer text */}
          <p className="mt-6 text-center font-body text-xs text-sepia-light/50">
            {mode === 'login'
              ? "Don't have an account? Click Register above."
              : 'Already have an account? Click Log In above.'}
          </p>
        </div>

        {/* Bottom quote */}
        <p className="mt-6 text-center font-pirate text-sm text-sepia-light/30 tracking-wide">
          "The sea is vast... and your bounty awaits."
        </p>
      </div>
    </div>
  )
}
