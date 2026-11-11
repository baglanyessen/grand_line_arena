import { useEffect, useMemo, useRef } from 'react'
import { BookOpen } from 'lucide-react'

/**
 * The move list. Takes the raw moveHistory and handles everything else itself:
 * pairing moves (1. e4 e5), and scrolling to the newest move.
 *
 * Returns a fragment (header + list) so it fits into the parent's flex column.
 */
export default function ShipsLog({ moveHistory }) {
  const logRef = useRef(null)

  // [w1, b1, w2, b2, ...] -> [{ number: 1, white, black }, ...]
  const pairedMoves = useMemo(() => {
    const pairs = []
    for (let i = 0; i < moveHistory.length; i += 2) {
      pairs.push({
        number: Math.floor(i / 2) + 1,
        white: moveHistory[i]?.san || '',
        black: moveHistory[i + 1]?.san || '',
      })
    }
    return pairs
  }, [moveHistory])

  // Keep the newest move visible
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [moveHistory])

  return (
    <>
      <div className="flex items-center gap-2 py-2">
        <BookOpen className="w-4 h-4 text-sepia-light" />
        <h3 className="font-display text-xs font-bold text-sepia tracking-widest uppercase">
          Ship's Log
        </h3>
      </div>

      <div ref={logRef} className="ships-log rounded-lg overflow-y-auto flex-1 min-h-0">
        {pairedMoves.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sepia-light/50">
            <p className="font-body text-xs italic text-center px-4">
              The seas are quiet...<br />
              Make your first move, Captain.
            </p>
          </div>
        ) : (
          <div className="p-1">
            {pairedMoves.map((pair) => (
              <div
                key={pair.number}
                className="ships-log-entry flex items-center gap-2 px-2 py-1.5 text-xs"
              >
                <span className="font-display text-sepia-light/60 w-5 text-right font-semibold">
                  {pair.number}.
                </span>
                <span className="font-body text-marine-blue font-semibold w-14 text-center">
                  {pair.white}
                </span>
                <span className="font-body text-pirate-dark font-semibold w-14 text-center">
                  {pair.black}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
