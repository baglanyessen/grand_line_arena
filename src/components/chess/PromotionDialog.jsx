import { useEffect, useRef } from 'react'
import { onePiecePieces } from './OnePiecePieces'

export default function PromotionDialog({ color, onChoose, onCancel }) {
  const dialogRef = useRef(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog ref={dialogRef} aria-labelledby="promotion-title" onCancel={event => { event.preventDefault(); onCancel() }}
      className="fixed inset-0 m-auto max-w-sm w-[90vw] rounded-xl border-2 border-wanted-border bg-parchment p-6 text-sepia backdrop:bg-black/60">
      <h2 id="promotion-title" className="font-display font-bold text-lg mb-2">Choose your promotion</h2>
      <p className="text-sm mb-4">Your pawn reached the other side. Choose its new piece.</p>
      <div className="grid grid-cols-4 gap-2">
        {[['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']].map(([piece, label], index) => {
          const Piece = onePiecePieces[`${color}${piece.toUpperCase()}`]
          return <button key={piece} autoFocus={index === 0} onClick={() => onChoose(piece)} aria-label={`Promote to ${label}`}
            className="rounded-lg border border-wanted-border p-2 hover:bg-parchment-dark"><span className="block aspect-square"><Piece /></span><span className="text-xs">{label}</span></button>
        })}
      </div>
      <button className="mt-5 text-sm underline" onClick={onCancel}>Cancel</button>
    </dialog>
  )
}
