import ChessClock from './ChessClock'

export default function PlayerProfile({ player, isTurn, clock, color, clockFrozen }) {
  return (
    <div className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${isTurn ? 'bg-wanted-border/10 border border-wanted-border/30 shadow-sm' : 'border border-transparent opacity-80'}`}>
      {player.avatar ? (
        <img src={player.avatar} alt={player.name} className="w-10 h-10 rounded shadow-md object-cover border border-wanted-border/50" />
      ) : (
        <div className="w-10 h-10 rounded shadow-md border border-wanted-border/50 bg-tavern-wood/80 flex items-center justify-center flex-shrink-0">
          <span className="font-display font-bold text-parchment text-sm">{player.name?.[0]?.toUpperCase() || '?'}</span>
        </div>
      )}
      <div className="flex flex-col min-w-0">
        <span className="font-display font-bold text-sepia text-sm leading-tight truncate">{player.name}</span>
        <span className="font-body text-xs text-sepia-light font-semibold mt-0.5">Bounty: {typeof player.bounty === 'number' ? player.bounty.toLocaleString() : '--'}</span>
      </div>
      {clock && <ChessClock clock={clock} color={color} frozen={clockFrozen} />}
    </div>
  )
}
