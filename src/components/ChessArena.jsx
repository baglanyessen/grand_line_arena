import { useState, useMemo, useCallback, useEffect } from 'react'
import { Chessboard } from 'react-chessboard'
import useChessGame from '../hooks/useChessGame'
import useMultiplayer from '../hooks/useMultiplayer'
import useBoardSize from '../hooks/useBoardSize'
import { useAuth } from '../context/AuthContext'
import PlayerProfile from './chess/PlayerProfile'
import ShipsLog from './chess/ShipsLog'
import GameControls from './chess/GameControls'
import DrawOfferModal from './chess/DrawOfferModal'
import GameOverModal from './chess/GameOverModal'
import { onePiecePieces } from './chess/OnePiecePieces'
import { needsPromotion } from '../lib/chessState'
import PromotionDialog from './chess/PromotionDialog'

// Static styles live outside the component so they aren't rebuilt on every render
const BOARD_FRAME_STYLE = {
  background: '#a66937',
  border: '3px solid #643b26',
  boxShadow: '0 6px 0 #643b26, 0 12px 22px rgba(40, 45, 35, 0.14)',
}
const NOTATION_STYLE = { fontFamily: 'Inter, sans-serif', fontSize: '10px', fontWeight: '600' }
const CHECK_HIGHLIGHT = {
  background: 'radial-gradient(circle, rgba(211,47,47,0.6) 30%, rgba(211,47,47,0.2) 70%)',
  borderRadius: '0',
}

/**
 * ChessArena: the main game screen.
 *
 * This file only connects things together:
 *   useChessGame    -> board rules and state
 *   useMultiplayer  -> websocket / online play
 *   small components -> profiles, move log, buttons, draw popup
 */
export default function ChessArena({ warRequest, onWarRequestHandled, onSignIn, isVisible = true }) {
  // ---------- Data & hooks ----------
  const { game: localGame, makeMove, undoMove, resetGame } = useChessGame()

  const { user } = useAuth()
  const {
    isConnected, connectionError, isSearching, opponent, gameId, assignedColor,
    connect, findMatch, leaveQueue, emitMove, resign, offerDraw, acceptDraw,
    snapshot, phase, matchResult, isMovePending, isReconnecting, declineDraw, clearGame, joinWarMatch, warWaitingId,
  } = useMultiplayer()

  const boardWidth = useBoardSize()
  const [moveSquares, setMoveSquares] = useState({}) // legal-move dots while dragging
  const [promotion, setPromotion] = useState(null)

  // true only while an online game is running
  const isOnline = !!gameId
  const game = isOnline && snapshot ? snapshot.game : localGame
  const fen = game.fen()
  const turn = game.turn()
  const moveHistory = isOnline && snapshot ? snapshot.moveHistory : game.history({ verbose: true })
  const isCheck = game.isCheck()
  const isGameOver = isOnline ? phase !== 'playing' || !!snapshot?.isGameOver : game.isGameOver()
  const canInteract = !isGameOver && !isMovePending && !isSearching && (!isOnline || isConnected)
  const incomingDrawOffer = isOnline && phase === 'playing' && snapshot?.drawOfferedBy && snapshot.drawOfferedBy !== user?.id

  // ---------- Websocket wiring ----------
  useEffect(() => {
    if (user) connect(user)
  }, [user, connect])

  useEffect(() => { setPromotion(null); setMoveSquares({}) }, [fen, gameId, phase, isConnected])
  useEffect(() => {
    if (isConnected && warRequest) { joinWarMatch(warRequest.id, warRequest.kind); onWarRequestHandled() }
  }, [isConnected, warRequest, joinWarMatch, onWarRequestHandled])

  // ---------- Who is who ----------
  const myProfile = {
    name: user?.username || 'You',
    bounty: user?.bounty ?? 0,
    avatar: user?.avatarUrl || null,
  }
  const opponentProfile = opponent
    ? { name: opponent.username, bounty: opponent.bounty, avatar: null }
    : { name: user ? 'Waiting...' : 'Black ? local practice', bounty: '—', avatar: null }

  // Opponent is always shown on top, we're always on the bottom.
  // Playing black flips the board so our pieces are at the bottom.
  const isFlipped = assignedColor === 'b'
  const clockFrozen = !isConnected || ['finished', 'disconnected', 'reconnecting', 'unavailable', 'finishing'].includes(phase)
  const opponentDisconnected = isOnline && snapshot?.presence?.[isFlipped ? 'w' : 'b'] === false
  const bottomIsTurn = assignedColor ? assignedColor === turn : turn === 'w'
  const topIsTurn = !bottomIsTurn

  // ---------- Highlights (calculated from game state, no extra useState) ----------
  const lastMoveSquares = useMemo(() => {
    const last = moveHistory[moveHistory.length - 1]
    if (!last?.from || !last?.to) return {}
    return {
      [last.from]: { background: 'rgba(255, 215, 0, 0.25)' },
      [last.to]: { background: 'rgba(255, 215, 0, 0.35)' },
    }
  }, [moveHistory])

  const checkSquare = useMemo(() => {
    if (!isCheck) return {}

    // Find the king of the side that is in check
    const board = game.board()
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c]
        if (piece && piece.type === 'k' && piece.color === turn) {
          const square = `${String.fromCharCode(97 + c)}${8 - r}`
          return { [square]: CHECK_HIGHLIGHT }
        }
      }
    }
    return {}
  }, [isCheck, turn, fen, game])

  // ---------- Board interaction ----------
  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }) => {
      if (!targetSquare || !canInteract || promotion) return false
      const piece = game.get(sourceSquare)
      if (!piece || piece.color !== turn || (isOnline && piece.color !== assignedColor)) return false
      if (!game.moves({ verbose: true }).some(move => move.from === sourceSquare && move.to === targetSquare)) return false
      setMoveSquares({})
      if (needsPromotion(game, sourceSquare, targetSquare)) {
        setPromotion({ from: sourceSquare, to: targetSquare, color: piece.color, fen, gameId })
        return false
      }
      if (isOnline) {
        emitMove({ from: sourceSquare, to: targetSquare })
        // Keep react-chessboard at the last confirmed position until the server replies.
        return false
      }
      return makeMove(sourceSquare, targetSquare)
    },
    [makeMove, emitMove, isOnline, canInteract, promotion, game, turn, assignedColor, fen, gameId]
  )

  // Show legal moves while a piece is being dragged
  const onPieceDrag = useCallback(
    ({ square }) => {
      if (!canInteract || promotion) return
      const moves = game.moves({ square, verbose: true })
      if (!moves.length) return

      const highlights = {}
      moves.forEach((move) => {
        const target = game.get(move.to)
        const isCapture = target && target.color !== game.get(square).color
        highlights[move.to] = {
          background: isCapture
            ? 'radial-gradient(circle, rgba(211,47,47,0.5) 85%, transparent 85%)'
            : 'radial-gradient(circle, rgba(62,47,31,0.3) 25%, transparent 25%)',
          borderRadius: '50%',
        }
      })
      highlights[square] = { background: 'rgba(255, 215, 0, 0.4)' }
      setMoveSquares(highlights)
    },
    [game, canInteract, promotion]
  )

  const onPieceDragEnd = useCallback(() => setMoveSquares({}), [])

  // Only the side to move can drag, and online you can only drag your own color
  const isDraggablePiece = useCallback(
    ({ piece }) => {
      if (!canInteract || promotion) return false
      const pieceColor = piece.pieceType[0]
      if (pieceColor !== turn) return false
      return isOnline ? pieceColor === assignedColor : true
    },
    [canInteract, promotion, turn, isOnline, assignedColor]
  )

  // ---------- Render ----------
  return (
    <>
      {warWaitingId && <p className="mb-4 p-3 rounded-lg bg-parchment text-sepia" role="status">Waiting for your assigned opponent. Clocks start when both players enter. <button className="underline" onClick={leaveQueue}>Leave waiting room</button></p>}
      {promotion && canInteract && <PromotionDialog color={promotion.color} onCancel={() => setPromotion(null)} onChoose={piece => {
        if (promotion.fen === fen && promotion.gameId === gameId) {
          if (isOnline) emitMove({ from: promotion.from, to: promotion.to, promotion: piece })
          else makeMove(promotion.from, promotion.to, piece)
        }
        setPromotion(null)
      }} />}
      {incomingDrawOffer && (
        <DrawOfferModal
          onAccept={acceptDraw}
          onDecline={declineDraw}
        />
      )}

      {matchResult && (
        <GameOverModal
          matchResult={matchResult}
          myColor={assignedColor}
          onClose={() => {
            if (clearGame()) resetGame()
          }}
        />
      )}


      <div className="chess-layout animate-fade-up">
        {/* Board column: opponent, board, me */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          <PlayerProfile player={opponentProfile} isTurn={topIsTurn} clock={isOnline ? snapshot?.clock : null} color={isFlipped ? 'w' : 'b'} clockFrozen={clockFrozen} />

          <div className="p-2.5 rounded-xl" style={BOARD_FRAME_STYLE}>
            <div style={{ width: boardWidth, height: boardWidth }}>
              {isVisible && <Chessboard
                options={{
                  id: 'GrandLineBoard',
                  pieces: onePiecePieces,
                  position: fen,
                  onPieceDrop,
                  onPieceDrag,
                  onPieceDragCancel: onPieceDragEnd,
                  canDragPiece: isDraggablePiece,
                  boardOrientation: isFlipped ? 'black' : 'white',
                  animationDurationInMs: 250,
                  boardStyle: { borderRadius: '4px' },
                  darkSquareStyle: { backgroundColor: '#4896b4' },
                  lightSquareStyle: { backgroundColor: '#fff0c9' },
                  dropSquareStyle: { boxShadow: 'inset 0 0 1px 5px rgba(211, 47, 47, 0.5)' },
                  squareStyles: { ...moveSquares, ...lastMoveSquares, ...checkSquare },
                  alphaNotationStyle: NOTATION_STYLE,
                  numericNotationStyle: NOTATION_STYLE,
                }}
              />}
            </div>
          </div>

          <PlayerProfile player={myProfile} isTurn={bottomIsTurn} clock={isOnline ? snapshot?.clock : null} color={isFlipped ? 'b' : 'w'} clockFrozen={clockFrozen} />
        </div>

        {/* Right panel: move log + buttons */}
        <div className="chess-tools">
          <div className="mb-3 text-xs text-sepia-light" role="status">
            {isOnline && <p className="mb-2 font-display font-semibold">Blitz · 5 + 0</p>}
            <p>{connectionError || (isReconnecting ? 'Restoring your match…' : isMovePending ? 'Waiting for move confirmation…' : isOnline ? phase === 'playing' ? 'Online game in progress.' : 'Game stopped.' : !user ? 'Local practice: play both sides. Sign in to find an online opponent.' : isConnected ? 'Connected. Ready to find a match.' : 'Connecting to the chess server…')}</p>
            {isConnected && phase === 'playing' && opponentDisconnected && <p className="mt-2 text-stamp-red">Opponent disconnected. They have 30 seconds to return. Clocks keep running.</p>}
            {!isConnected && connectionError && <button className="mt-2 underline font-semibold" onClick={() => connect(user)}>Reconnect</button>}
            {phase === 'unavailable' && <button className="mt-2 block underline font-semibold" onClick={() => { if (clearGame()) resetGame() }}>Return to practice</button>}
          </div>
          <ShipsLog moveHistory={moveHistory} />
          <GameControls
            isConnected={isConnected}
            isSearching={isSearching}
            isOnline={isOnline}
            isGameOver={isGameOver}
            isLocked={isSearching || isMovePending || !!promotion}
            canUndo={moveHistory.length > 0}
            requiresSignIn={!user}
            onFindMatch={user ? findMatch : onSignIn}
            onLeaveQueue={leaveQueue}
            onUndo={undoMove}
            onReset={resetGame}
            onResign={resign}
            onOfferDraw={offerDraw}
          />
        </div>
      </div>
    </>
  )
}
