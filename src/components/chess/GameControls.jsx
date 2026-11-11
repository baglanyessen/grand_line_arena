import { RotateCcw, Undo2, Search, Loader2, Flag, Handshake } from 'lucide-react'

// The small buttons all share the same base look; only the colors differ.
const SMALL_BUTTON =
  'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-display text-xs font-semibold tracking-wide uppercase transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
const NEUTRAL =
  'bg-parchment-dark/50 text-sepia border border-wanted-border/30 hover:bg-parchment-dark hover:border-wanted-border/50'
const DANGER =
  'bg-stamp-red/10 text-stamp-red border border-stamp-red/20 hover:bg-stamp-red/20 hover:border-stamp-red/30'
const TEAL =
  'bg-ocean-teal/10 text-ocean-teal border border-ocean-teal/20 hover:bg-ocean-teal/20 hover:border-ocean-teal/30'

/**
 * All the buttons under the Ship's Log.
 * This component has no logic of its own: it just shows buttons and
 * calls the functions ChessArena gives it.
 */
export default function GameControls({
  requiresSignIn = false,
  isConnected,
  isSearching,
  isOnline,
  isGameOver,
  isLocked,
  canUndo,
  onFindMatch,
  onLeaveQueue,
  onUndo,
  onReset,
  onResign,
  onOfferDraw,
}) {
  return (
    <div className="flex flex-col gap-2 mt-3">
      {/* Find Match / Cancel search */}
      <button
        onClick={isSearching ? onLeaveQueue : onFindMatch}
        disabled={isOnline || (!isConnected && !requiresSignIn)}
        className={`
          w-full flex items-center justify-center gap-2
          px-4 py-2.5 rounded-xl
          font-display text-sm font-bold tracking-wider uppercase
          transition-all duration-300 ease-out
          cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed
          ${
            isSearching
              ? 'bg-sepia-light/20 text-sepia-light border-2 border-sepia-light/30'
              : 'bg-stamp-red text-parchment border-2 border-stamp-red-dark shadow-button hover:bg-stamp-red-dark hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]'
          }
        `}
      >
        {isSearching ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Searching...</span>
          </>
        ) : (
          <>
            <Search className="w-4 h-4" />
            <span>{requiresSignIn ? 'Sign in to play online' : 'Find Match'}</span>
          </>
        )}
      </button>

      {/* Undo / Reset: local-only, so they're off during an online game */}
      <div className="flex gap-2">
        <button
          onClick={onUndo}
          disabled={isOnline || isLocked || !canUndo}
          className={`${SMALL_BUTTON} ${NEUTRAL}`}
          title="Undo last move"
        >
          <Undo2 className="w-3.5 h-3.5" />
          <span>Undo</span>
        </button>

        <button
          onClick={onReset}
          disabled={isOnline || isLocked}
          className={`${SMALL_BUTTON} ${NEUTRAL}`}
          title="Reset game"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>
      </div>

      {/* Resign / Draw: only make sense in an online game */}
      <div className="flex gap-2">
        <button
          onClick={onResign}
          disabled={isGameOver || !isOnline || !isConnected || isLocked}
          className={`${SMALL_BUTTON} ${DANGER}`}
          title="Resign"
        >
          <Flag className="w-3.5 h-3.5" />
          <span>Resign</span>
        </button>

        <button
          onClick={onOfferDraw}
          disabled={isGameOver || !isOnline || !isConnected || isLocked}
          className={`${SMALL_BUTTON} ${TEAL}`}
          title="Offer draw"
        >
          <Handshake className="w-3.5 h-3.5" />
          <span>Draw</span>
        </button>
      </div>
    </div>
  )
}
