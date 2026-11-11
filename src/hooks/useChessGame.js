import { useState, useCallback, useRef } from 'react'
import { Chess } from 'chess.js'
import { playLocalMove, undoLocalMove } from '../lib/chessState'

export default function useChessGame() {
  const gameRef = useRef(new Chess())
  const [game, setGame] = useState(gameRef.current)
  const commit = useCallback(next => { gameRef.current = next; setGame(next) }, [])
  const makeMove = useCallback((from, to, promotion) => {
    try { commit(playLocalMove(gameRef.current, { from, to, promotion })); return true }
    catch { return false }
  }, [commit])
  const undoMove = useCallback(() => {
    const next = undoLocalMove(gameRef.current)
    if (next) commit(next)
  }, [commit])
  const resetGame = useCallback(() => commit(new Chess()), [commit])
  return { game, makeMove, undoMove, resetGame }
}
