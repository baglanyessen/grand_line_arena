export default function DrawOfferModal({ onAccept, onDecline }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-parchment p-6 rounded-xl shadow-2xl border-2 border-wanted-border/30 max-w-sm w-full text-center animate-fade-up">
        <h3 className="font-pirate text-3xl text-sepia mb-2">Draw Offered</h3>
        <p className="font-body text-sepia-light mb-6">
          Your opponent has offered a draw. Do you accept?
        </p>
        <div className="flex gap-3">
          <button
            onClick={onAccept}
            className="flex-1 px-4 py-2.5 bg-ocean-teal text-parchment font-display text-sm tracking-wider font-bold uppercase rounded-lg shadow-button hover:bg-ocean-teal/90 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
          >
            Accept
          </button>
          <button
            onClick={onDecline}
            className="flex-1 px-4 py-2.5 bg-stamp-red/10 text-stamp-red font-display text-sm tracking-wider font-bold uppercase rounded-lg border border-stamp-red/20 hover:bg-stamp-red/20 transition-all cursor-pointer"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  )
}
