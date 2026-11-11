import { useEffect, useState } from 'react'
import { Timer } from 'lucide-react'
import { formatClock, remainingAt } from '../../lib/chessClock'

export default function ChessClock({ clock, color, frozen }) {
  const [remaining, setRemaining] = useState(() => remainingAt(clock, color))
  useEffect(() => {
    const update = () => setRemaining(remainingAt(clock, color))
    update()
    if (frozen || clock.running !== color) return
    const timer = setInterval(update, 100)
    return () => clearInterval(timer)
  }, [clock, color, frozen])
  const running = !frozen && clock.running === color
  return <div role="timer" aria-live="off" aria-label={`${color === 'w' ? 'White' : 'Black'} clock: ${formatClock(remaining)}`}
    className={`ml-auto flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xl font-bold tabular-nums ${remaining < 30_000 ? 'border-stamp-red/50 bg-stamp-red/10 text-stamp-red' : running ? 'border-tavern-wood bg-tavern-wood text-parchment' : 'border-wanted-border/30 bg-parchment-light text-sepia'}`}>
    <Timer size={16} aria-hidden="true" /><span>{formatClock(remaining)}</span>
  </div>
}
