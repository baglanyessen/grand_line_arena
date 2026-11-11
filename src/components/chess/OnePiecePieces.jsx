import { defaultPieces } from 'react-chessboard'

// Shared vector artwork stays sharp on the board, while dragging, and in the lobby.
function MarineCap() {
  return (
    <g stroke="#203f57" strokeWidth="2.5" strokeLinejoin="round">
      <path d="M24 35V26C24 13 35 8 50 8S76 13 76 26V35Z" fill="#fffdf2" />
      <path d="M27 29Q50 35 73 29L76 37Q50 45 24 37Z" fill="#f0eddf" />
      <path d="M24 36Q46 32 76 36L84 41Q59 50 28 43L19 40Z" fill="#244e6a" />
      <path d="M34 20Q39 13 50 22Q61 13 66 20M50 22V26" fill="none" stroke="#268c8b" strokeWidth="3" strokeLinecap="round" />
      <text x="50" y="33" textAnchor="middle" fill="#147977" stroke="none" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="8" letterSpacing="1">MARINE</text>
    </g>
  )
}

function StrawHat() {
  return (
    <g stroke="#76512c" strokeWidth="2.5" strokeLinejoin="round">
      <path d="M26 32C27 16 33 10 50 10S73 16 74 32Z" fill="#eac36d" />
      <path d="M33 17L30 28M42 13L40 28M52 13V28M62 16L65 28" stroke="#c49548" strokeWidth="1.3" fill="none" />
      <path d="M26 27Q50 32 74 27L76 36Q50 43 24 36Z" fill="#cb4540" />
      <ellipse cx="50" cy="39" rx="41" ry="9" fill="#edcb7e" />
      <path d="M16 39Q50 49 84 39M23 37L26 41M34 36L36 43M48 36V44M62 36L60 43M76 37L73 42" stroke="#c1974f" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </g>
  )
}

function KingBody({ marine, fill }) {
  const outline = marine ? '#263e50' : '#0d1c28'
  const accent = marine ? '#3d7392' : '#d1b06b'
  return (
    <g stroke={outline} strokeWidth="2.6" strokeLinejoin="round" fill={fill ?? (marine ? '#fff8e7' : '#28343e')}>
      <path d="M30 46Q50 38 70 46L64 55Q58 65 63 75L70 81H30L37 75Q42 65 36 55Z" />
      <path d="M29 46Q50 53 71 46L68 54Q50 61 32 54Z" />
      <path d="M29 79H71L77 88H23Z" />
      <path d="M23 87H77L80 94H20Z" />
      <path d="M36 51Q50 55 64 51M32 83H68M27 90H73" fill="none" stroke={accent} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M46 62V73M55 62L46 68L56 74" fill="none" stroke={accent} strokeWidth="2.8" strokeLinecap="round" />
    </g>
  )
}

export function MarineKing(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label="White king wearing a Marine cap" style={{ ...props?.svgStyle, display: 'block', pointerEvents: 'none' }}>
      <title>Marine king · White</title>
      <KingBody marine fill={props?.fill} />
      <MarineCap />
    </svg>
  )
}

export function StrawHatKing(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label="Black king wearing a straw hat" style={{ ...props?.svgStyle, display: 'block', pointerEvents: 'none' }}>
      <title>Straw Hat king · Black</title>
      <KingBody fill={props?.fill} />
      <StrawHat />
    </svg>
  )
}

export function StrawHatEmblem({ className }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label="Straw Hat pirate emblem">
      <g fill="none" stroke="#403625" strokeWidth="6" strokeLinecap="round">
        <path d="M20 58L80 88M20 88L80 58" />
        <path d="M17 53L23 59L17 65M77 82L83 88L77 94M17 82L23 88L17 94M77 53L83 59L77 65" strokeWidth="4" />
      </g>
      <path d="M28 52C28 36 72 36 72 52V62Q70 72 62 74V85H38V74Q28 72 28 62Z" fill="#f8ebcb" stroke="#403625" strokeWidth="2.5" />
      <ellipse cx="39" cy="57" rx="6" ry="7" fill="#403625" />
      <ellipse cx="61" cy="57" rx="6" ry="7" fill="#403625" />
      <path d="M50 63L46 69H54Z" fill="#403625" />
      <path d="M38 76H62M44 75V84M50 75V85M56 75V84" stroke="#403625" strokeWidth="1.8" />
      <StrawHat />
    </svg>
  )
}

// Supplying `pieces` replaces the library map, so retain every other piece.
export const onePiecePieces = { ...defaultPieces, wK: MarineKing, bK: StrawHatKing }
