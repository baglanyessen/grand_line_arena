import { useState, useEffect } from 'react'

// Space we reserve around the board (same numbers as before, now named)
const RESERVED_HEIGHT = 300 // header, profiles, heading, padding and board frame
const SIDEBAR_WIDTH = 236
const LOG_PANEL_WIDTH = 220 // Ship's Log + controls on the right
const EXTRA_PADDING = 80
const MIN_SIZE = 160
const MAX_SIZE = 720

function calcBoardSize() {
  const { innerHeight, innerWidth } = window
  const mobile = innerWidth <= 760
  const sidebar = mobile ? 0 : innerWidth <= 1000 ? 185 : innerWidth <= 1250 ? 210 : SIDEBAR_WIDTH
  const availableWidth = mobile ? innerWidth - 64 : innerWidth - sidebar - LOG_PANEL_WIDTH - EXTRA_PADDING
  const availableHeight = mobile ? 500 : innerHeight - RESERVED_HEIGHT

  return Math.max(MIN_SIZE, Math.min(availableHeight, availableWidth, MAX_SIZE))
}

/**
 * Returns the board size in pixels and keeps it updated when the window resizes.
 */
export default function useBoardSize() {
  // Passing the function (not calling it) means it only runs once, on first render
  const [size, setSize] = useState(calcBoardSize)

  useEffect(() => {
    const handleResize = () => setSize(calcBoardSize())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return size
}
