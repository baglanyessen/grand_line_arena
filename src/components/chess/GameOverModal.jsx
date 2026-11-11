import { useAuth } from '../../context/AuthContext'

export default function GameOverModal({ matchResult, myColor, onClose }) {
    const { settlements, user } = useAuth()
    const warBonus = matchResult.warSettlement?.rewards.find(reward => reward.userId === user?.id)
    const reward = matchResult.bountyReward ?? settlements[matchResult.gameId]
    const delta = reward?.[myColor === 'w' ? 'whiteDelta' : 'blackDelta']
    const after = reward?.[myColor === 'w' ? 'whiteAfter' : 'blackAfter']
    const myFullColor = myColor === 'w' ? 'white' : 'black'
    const isDraw = matchResult.result === 'draw'
    const isWinner = matchResult.result === myFullColor

    // This single line already calculates exactly what the CURRENT player should see!
    const title = isDraw ? "It's a Draw!" : isWinner ? "Victory!" : "Defeat!"

    // Format the reason (e.g., 'checkmate' -> 'Checkmate')
    const reasonLabels = { timeout: 'Time ran out', timeout_no_mating_material: 'Time ran out; opponent has only a king', abandonment: 'Reconnect window expired', both_disconnected: 'Both players disconnected' }
    const formattedReason = reasonLabels[matchResult.reason] || (matchResult.reason
        ? matchResult.reason.charAt(0).toUpperCase() + matchResult.reason.slice(1)
        : '')

    const titleColor = isDraw ? 'text-sepia' : isWinner ? 'text-ocean-teal' : 'text-stamp-red'

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
            <div className="bg-parchment p-8 rounded-2xl shadow-2xl border-4 border-wanted-border/50 max-w-sm w-full text-center animate-fade-up">

                <div className="mb-6">
                    <h3 className={`font-pirate text-4xl ${titleColor} drop-shadow-sm mb-1`}>
                        {title}
                    </h3>
                    <p className="font-display text-sm font-semibold tracking-widest uppercase text-sepia-light/80">
                        {formattedReason}
                    </p>
                </div>

                {reward && <div className="mb-4 text-sepia" role="status">
                    <p className="font-display text-2xl font-bold">{delta > 0 ? '+' : ''}{delta?.toLocaleString()} ฿</p>
                    <p className="text-sm">Bounty after match: ฿ {after?.toLocaleString()}</p>
                    {reward.status === 'short_game' && <p className="text-xs">Bounty requires at least 4 half-moves.</p>}
                    {reward.status === 'pair_limit' && <p className="text-xs">Daily bounty limit for this opponent reached.</p>}
                </div>}
                {matchResult.leadershipMatchId && <p className="mb-4 text-sm text-sepia">Leadership round finished. Open Captain's challenge to see the series and the captain's hat.</p>}
                {warBonus && <p className="mb-4 text-sm text-sepia">War bonus: +{warBonus.delta.toLocaleString()} bounty. Your crew's war has finished.</p>}

                {matchResult.persistence && <p className="mb-4 text-xs text-sepia-light" role="status">
                    {matchResult.persistence === 'saved' || reward ? 'Saved to match history.' : 'Saving to match history…'}
                </p>}

                <button
                    onClick={onClose}
                    className="w-full px-4 py-3 bg-wanted-border text-parchment font-display text-sm tracking-wider font-bold uppercase rounded-xl shadow-button hover:bg-wanted-border/90 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                >
                    Return to Practice
                </button>
            </div>
        </div>
    )
}
