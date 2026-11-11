// Adapted from Chess King by Shudipto Trafder (Iamsdt/chess), MIT. See README.md and public/licenses/chess-king-MIT.txt.
export const PUZZLES = [
  {
    "id": "e01",
    "title": "Fool's Mate",
    "fen": "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2",
    "solution": [
      "d8h4"
    ],
    "theme": "checkmate",
    "difficulty": "easy",
    "description": "Black to move — the fastest checkmate in chess!"
  },
  {
    "id": "e02",
    "title": "Scholar's Mate",
    "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
    "solution": [
      "h5f7"
    ],
    "theme": "checkmate",
    "difficulty": "easy",
    "description": "White to move — deliver Scholar's Mate in one move."
  },
  {
    "id": "e03",
    "title": "Back Rank Strike",
    "fen": "5r1k/6pp/8/8/8/8/6PP/5R1K w - - 0 1",
    "solution": [
      "f1f8"
    ],
    "theme": "back-rank",
    "difficulty": "easy",
    "description": "White to move — the back rank is fatally weak."
  },
  {
    "id": "e04",
    "title": "Smothered King",
    "fen": "6rk/5ppp/7N/8/8/8/8/6K1 w - - 0 1",
    "solution": [
      "h6f7"
    ],
    "theme": "checkmate",
    "difficulty": "easy",
    "description": "White to move — the knight delivers a killing blow."
  },
  {
    "id": "e07",
    "title": "Bishop + Rook",
    "fen": "k7/B1R5/1K6/8/8/8/8/8 w - - 0 1",
    "solution": [
      "c7c8"
    ],
    "theme": "checkmate",
    "difficulty": "easy",
    "description": "White to move — bishop and rook work together to mate."
  },
  {
    "id": "e08",
    "title": "Pawn Promotes and Mates",
    "fen": "8/P6k/8/8/8/8/8/7K w - - 0 1",
    "solution": [
      "a7a8q"
    ],
    "theme": "promotion",
    "difficulty": "easy",
    "description": "White to move — promote and deliver checkmate."
  },
  {
    "id": "e11",
    "title": "Royal Fork",
    "fen": "r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1",
    "solution": [
      "d5c7"
    ],
    "theme": "fork",
    "difficulty": "easy",
    "description": "White to move — one knight move attacks two pieces at once."
  },
  {
    "id": "e12",
    "title": "Hanging Queen",
    "fen": "r1bqkbnr/pppp1ppp/8/4p3/3nP3/3Q4/PPPP1PPP/RNB1KBNR w KQkq - 3 4",
    "solution": [
      "d3d4"
    ],
    "theme": "hanging",
    "difficulty": "easy",
    "description": "White to move — win a piece with a simple move."
  },
  {
    "id": "m01",
    "title": "Knight Fork Clinic",
    "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 4",
    "solution": [
      "f3e5"
    ],
    "theme": "fork",
    "difficulty": "medium",
    "description": "White to move — the knight can fork two pieces simultaneously."
  },
  {
    "id": "m02",
    "title": "Winning the Exchange",
    "fen": "r1b1k2r/ppppqppp/2n2n2/4p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 1 7",
    "solution": [
      "f3g5"
    ],
    "theme": "fork",
    "difficulty": "medium",
    "description": "White to move — find the fork that wins material."
  },
  {
    "id": "m03",
    "title": "Discovered Attack",
    "fen": "r1bqkb1r/pppp1ppp/2n5/3Pp3/8/8/PPP1PPPP/RNBQKBNR w KQkq e6 0 4",
    "solution": [
      "d5e6"
    ],
    "theme": "discovered",
    "difficulty": "medium",
    "description": "White to move — en passant reveals a discovered attack."
  },
  {
    "id": "m06",
    "title": "Deflection",
    "fen": "r4rk1/ppp2ppp/2n1p3/3qn3/3P4/2NB1N2/PPP2PPP/R2QR1K1 w - - 0 12",
    "solution": [
      "d3h7"
    ],
    "theme": "deflection",
    "difficulty": "medium",
    "description": "White to move — sacrifice to deflect the king's defender."
  },
  {
    "id": "m08",
    "title": "Zwischenzug",
    "fen": "r3r1k1/pp3ppp/2p5/3pb3/3P4/2N2N2/PPQ2PPP/R1B1R1K1 b - - 0 15",
    "solution": [
      "e5f4"
    ],
    "theme": "hanging",
    "difficulty": "medium",
    "description": "Black to move — don't recapture yet; find the in-between move."
  },
  {
    "id": "m09",
    "title": "Windmill Prelude",
    "fen": "r4rk1/1pp2ppp/p1np1q2/4pb2/2B1P3/6PP/PPP1NPB1/R2Q1RK1 w - - 1 14",
    "solution": [
      "c4f7"
    ],
    "theme": "deflection",
    "difficulty": "medium",
    "description": "White to move — a bishop sacrifice starts a winning combination."
  },
  {
    "id": "m11",
    "title": "Decoy Sacrifice",
    "fen": "3r2k1/pp3ppp/4p3/3rP3/8/1B3N2/PP3PPP/3R2K1 w - - 0 18",
    "solution": [
      "b3d5"
    ],
    "theme": "deflection",
    "difficulty": "medium",
    "description": "White to move — lure the rook off a key square."
  },
  {
    "id": "m12",
    "title": "Knight Outpost Fork",
    "fen": "2rr2k1/5pp1/p3p2p/1p2N3/1Pn5/P1B3P1/5P1P/2RR2K1 w - - 0 25",
    "solution": [
      "e5c6"
    ],
    "theme": "fork",
    "difficulty": "medium",
    "description": "White to move — the knight springs to life."
  },
  {
    "id": "m13",
    "title": "Overloaded Defender",
    "fen": "2r2rk1/5ppp/1q2p3/pp2P3/3p1PP1/1P1R4/PBQ3PP/5RK1 b - - 0 22",
    "solution": [
      "c8c2"
    ],
    "theme": "deflection",
    "difficulty": "medium",
    "description": "Black to move — the defender has too much to protect."
  },
  {
    "id": "m14",
    "title": "Double Attack",
    "fen": "r1b2rk1/pp2ppbp/2np2p1/q7/3NP3/2N1B3/PPP2PPP/R2QKB1R w KQ - 3 10",
    "solution": [
      "d4b5"
    ],
    "theme": "fork",
    "difficulty": "medium",
    "description": "White to move — the knight jumps to a powerful square."
  },
  {
    "id": "m18",
    "title": "Promotion Tactic",
    "fen": "8/1P6/8/8/8/8/k7/7K w - - 0 1",
    "solution": [
      "b7b8q"
    ],
    "theme": "promotion",
    "difficulty": "medium",
    "description": "White to move — promote to win or force immediate advantage."
  },
  {
    "id": "h01",
    "title": "Greek Gift",
    "fen": "r1bqk2r/ppp2ppp/3p1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 7",
    "solution": [
      "c4f7",
      "e8f7",
      "f3g5"
    ],
    "theme": "deflection",
    "difficulty": "hard",
    "description": "White to move — a famous bishop sacrifice starts a fierce attack."
  }
]

export const OPENINGS = [
  {
    "eco": "C20",
    "name": "King's Pawn Opening",
    "moves": "e4 e5",
    "category": "open",
    "idea": "Both sides seize the center with pawns, leading to open, tactical positions."
  },
  {
    "eco": "C60",
    "name": "Ruy Lopez (Spanish Opening)",
    "moves": "e4 e5 Nf3 Nc6 Bb5",
    "category": "open",
    "idea": "White pressures the knight on c6 and prepares to castle while contesting the center."
  },
  {
    "eco": "C67",
    "name": "Ruy Lopez — Berlin Defense",
    "moves": "e4 e5 Nf3 Nc6 Bb5 Nf6",
    "category": "open",
    "idea": "Black defends solidly with the knight, often leading to a favorable endgame. Favored by top grandmasters."
  },
  {
    "eco": "C50",
    "name": "Italian Game",
    "moves": "e4 e5 Nf3 Nc6 Bc4",
    "category": "open",
    "idea": "White develops the bishop to a strong diagonal targeting f7 and the center. Very common at club level."
  },
  {
    "eco": "C54",
    "name": "Giuoco Piano",
    "moves": "e4 e5 Nf3 Nc6 Bc4 Bc5 c3",
    "category": "open",
    "idea": "White prepares d4 to build a strong pawn center. A classic, solid opening."
  },
  {
    "eco": "C55",
    "name": "Two Knights Defense",
    "moves": "e4 e5 Nf3 Nc6 Bc4 Nf6",
    "category": "open",
    "idea": "Black counterattacks with the knight rather than defending, creating sharp tactical complications."
  },
  {
    "eco": "C44",
    "name": "Scotch Game",
    "moves": "e4 e5 Nf3 Nc6 d4",
    "category": "open",
    "idea": "White immediately challenges the center with d4, seizing the initiative and opening the position early."
  },
  {
    "eco": "C45",
    "name": "Scotch Game — Main Line",
    "moves": "e4 e5 Nf3 Nc6 d4 exd4 Nxd4",
    "category": "open",
    "idea": "After the central exchange, White's knight is powerfully centralized on d4. Kasparov's favorite weapon."
  },
  {
    "eco": "C40",
    "name": "Petrov's Defense",
    "moves": "e4 e5 Nf3 Nf6",
    "category": "open",
    "idea": "Black mirrors White's knight move — a solid, symmetrical defense that avoids most sharp lines."
  },
  {
    "eco": "C30",
    "name": "King's Gambit",
    "moves": "e4 e5 f4",
    "category": "open",
    "idea": "White sacrifices a pawn for rapid development and a ferocious kingside attack. A romantic, attacking opening."
  },
  {
    "eco": "C33",
    "name": "King's Gambit Accepted",
    "moves": "e4 e5 f4 exf4",
    "category": "open",
    "idea": "Black accepts the pawn sacrifice, forcing White to prove the compensation is sufficient."
  },
  {
    "eco": "C23",
    "name": "Bishop's Opening",
    "moves": "e4 e5 Bc4",
    "category": "open",
    "idea": "An early bishop development, less committal than Nf3, keeping flexible transposition options."
  },
  {
    "eco": "C20",
    "name": "Vienna Game",
    "moves": "e4 e5 Nc3",
    "category": "open",
    "idea": "White reinforces e4 with the knight, keeping the center flexible and preparing f4."
  },
  {
    "eco": "C25",
    "name": "Vienna Gambit",
    "moves": "e4 e5 Nc3 Nc6 f4",
    "category": "open",
    "idea": "White combines the Vienna setup with an aggressive f4 pawn thrust, creating a mini King's Gambit."
  },
  {
    "eco": "C41",
    "name": "Philidor Defense",
    "moves": "e4 e5 Nf3 d6",
    "category": "open",
    "idea": "Black solidly defends e5 with a pawn. The position can become passive, but is structurally sound."
  },
  {
    "eco": "B20",
    "name": "Sicilian Defense",
    "moves": "e4 c5",
    "category": "semi-open",
    "idea": "The most popular reply to e4 at every level. Black fights for the center asymmetrically, creating complex positions where both sides have winning chances."
  },
  {
    "eco": "B22",
    "name": "Sicilian Alapin",
    "moves": "e4 c5 c3",
    "category": "semi-open",
    "idea": "White prepares d4 next move, sidestepping vast amounts of Sicilian theory. A solid, practical weapon."
  },
  {
    "eco": "B23",
    "name": "Closed Sicilian",
    "moves": "e4 c5 Nc3",
    "category": "semi-open",
    "idea": "White avoids the open Sicilian by reinforcing e4, keeping tension and planning a kingside attack."
  },
  {
    "eco": "B21",
    "name": "Smith-Morra Gambit",
    "moves": "e4 c5 d4 cxd4 c3",
    "category": "semi-open",
    "idea": "White sacrifices a pawn for rapid development against the Sicilian. A dangerous weapon in club chess."
  },
  {
    "eco": "B60",
    "name": "Sicilian Najdorf",
    "moves": "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6",
    "category": "semi-open",
    "idea": "The most analyzed opening in chess. a6 prevents Bb5 and prepares queenside expansion. Kasparov's and Fischer's signature weapon."
  },
  {
    "eco": "B70",
    "name": "Sicilian Dragon",
    "moves": "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6",
    "category": "semi-open",
    "idea": "Black fianchettoes the bishop on g7, creating a powerful 'dragon' diagonal. Sharp and double-edged with opposite-side castling attacks."
  },
  {
    "eco": "B80",
    "name": "Sicilian Scheveningen",
    "moves": "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6",
    "category": "semi-open",
    "idea": "A flexible system where Black builds a solid center and waits to react. Rich in strategic ideas."
  },
  {
    "eco": "B01",
    "name": "Scandinavian Defense",
    "moves": "e4 d5",
    "category": "semi-open",
    "idea": "Black immediately challenges e4 with d5. After exd5, Black usually recaptures with the queen, leading to unique positions."
  },
  {
    "eco": "B02",
    "name": "Scandinavian Defense — Center Variation",
    "moves": "e4 d5 exd5 Qxd5",
    "category": "semi-open",
    "idea": "Black develops the queen early but it can be harassed. The compensation is quick development and a clear center."
  },
  {
    "eco": "B10",
    "name": "Caro-Kann Defense",
    "moves": "e4 c6",
    "category": "semi-open",
    "idea": "Black prepares d5 with c6, maintaining a sound pawn structure. Solid and reliable — a favorite of Karpov."
  },
  {
    "eco": "B12",
    "name": "Caro-Kann Advance Variation",
    "moves": "e4 c6 d4 d5 e5",
    "category": "semi-open",
    "idea": "White advances and grabs space with e5. Black targets the d4 pawn and seeks queenside counterplay."
  },
  {
    "eco": "B15",
    "name": "Caro-Kann — Main Line",
    "moves": "e4 c6 d4 d5 Nc3",
    "category": "semi-open",
    "idea": "The classical main line — White develops naturally while Black prepares to recapture with the c-pawn."
  },
  {
    "eco": "C00",
    "name": "French Defense",
    "moves": "e4 e6",
    "category": "semi-open",
    "idea": "Black prepares d5 with e6, creating a solid but potentially cramped position. Rich in strategic ideas on both sides."
  },
  {
    "eco": "C02",
    "name": "French Advance Variation",
    "moves": "e4 e6 d4 d5 e5",
    "category": "semi-open",
    "idea": "White claims space with e5. Black attacks the d4 pawn chain and seeks counterplay on the queenside."
  },
  {
    "eco": "C11",
    "name": "French Defense — Classical",
    "moves": "e4 e6 d4 d5 Nc3 Nf6",
    "category": "semi-open",
    "idea": "Black develops the knight to f6, attacking White's center directly. A critical theoretical battle."
  },
  {
    "eco": "B07",
    "name": "Pirc Defense",
    "moves": "e4 d6 d4 Nf6 Nc3 g6",
    "category": "semi-open",
    "idea": "Black allows White a big center, then counterattacks it with pieces from the flanks. Flexible and hypermodern."
  },
  {
    "eco": "B06",
    "name": "Modern Defense",
    "moves": "e4 g6",
    "category": "semi-open",
    "idea": "Black fianchettoes immediately, ceding the center then attacking it later with pieces. Very flexible."
  },
  {
    "eco": "B00",
    "name": "Nimzowitsch Defense",
    "moves": "e4 Nc6",
    "category": "semi-open",
    "idea": "Black develops a knight to fight for center control without committing pawns. Unorthodox but playable."
  },
  {
    "eco": "D06",
    "name": "Queen's Gambit",
    "moves": "d4 d5 c4",
    "category": "closed",
    "idea": "White offers a pawn to gain central control. The most classical queen's pawn opening, played at the highest levels for centuries."
  },
  {
    "eco": "D30",
    "name": "Queen's Gambit Declined",
    "moves": "d4 d5 c4 e6",
    "category": "closed",
    "idea": "Black firmly declines the gambit, maintaining a solid central pawn. Structurally sound but requires patience."
  },
  {
    "eco": "D20",
    "name": "Queen's Gambit Accepted",
    "moves": "d4 d5 c4 dxc4",
    "category": "closed",
    "idea": "Black accepts the pawn but will return it for quick development and active counterplay."
  },
  {
    "eco": "D10",
    "name": "Slav Defense",
    "moves": "d4 d5 c4 c6",
    "category": "closed",
    "idea": "A solid reply that supports d5 without blocking the c8 bishop — one of Black's most reliable defenses."
  },
  {
    "eco": "D31",
    "name": "Semi-Slav Defense",
    "moves": "d4 d5 c4 e6 Nc3 c6",
    "category": "closed",
    "idea": "A hybrid of QGD and Slav — flexible and rich in both strategic and tactical ideas. Highly theoretical."
  },
  {
    "eco": "E60",
    "name": "King's Indian Defense",
    "moves": "d4 Nf6 c4 g6",
    "category": "closed",
    "idea": "Black fianchettoes and allows White a big center, then launches a kingside attack with e5. Aggressive and counterattacking — Fischer's favorite."
  },
  {
    "eco": "E20",
    "name": "Nimzo-Indian Defense",
    "moves": "d4 Nf6 c4 e6 Nc3 Bb4",
    "category": "closed",
    "idea": "Black pins White's knight with the bishop, disrupting center control. One of the most solid and respected defenses, invented by Nimzowitsch."
  },
  {
    "eco": "A50",
    "name": "Queen's Indian Defense",
    "moves": "d4 Nf6 c4 e6 Nf3 b6",
    "category": "closed",
    "idea": "Black fianchettoes the queen's bishop to control the long a8-h1 diagonal. Flexible and strategic."
  },
  {
    "eco": "D80",
    "name": "Grünfeld Defense",
    "moves": "d4 Nf6 c4 g6 Nc3 d5",
    "category": "closed",
    "idea": "Black allows White a massive center then attacks it with pieces. Very theoretical and sharp — a favorite of Bobby Fischer."
  },
  {
    "eco": "A00",
    "name": "Dutch Defense",
    "moves": "d4 f5",
    "category": "closed",
    "idea": "Black seizes the e4 square immediately with f5, aiming for a kingside attack. Unbalanced and aggressive."
  },
  {
    "eco": "A43",
    "name": "London System",
    "moves": "d4 d5 Nf3 Nf6 Bf4",
    "category": "closed",
    "idea": "A solid, flexible system where White develops calmly and avoids theoretical fights. Very popular at club level."
  },
  {
    "eco": "A45",
    "name": "Trompowsky Attack",
    "moves": "d4 Nf6 Bg5",
    "category": "closed",
    "idea": "White immediately pins the knight, trying to create imbalances and sidestep main-line theory."
  },
  {
    "eco": "E00",
    "name": "Catalan Opening",
    "moves": "d4 Nf6 c4 e6 g3",
    "category": "closed",
    "idea": "White combines Queen's Gambit strategy with a fianchettoed bishop on g2, creating long-term pressure on the queenside."
  },
  {
    "eco": "A10",
    "name": "English Opening",
    "moves": "c4",
    "category": "flank",
    "idea": "White controls d5 with the c-pawn, often transposing into d4 openings or leading to unique reversed-Sicilian structures."
  },
  {
    "eco": "A20",
    "name": "English Opening — King's English",
    "moves": "c4 e5",
    "category": "flank",
    "idea": "Black seizes the center immediately. Leads to rich strategic positions related to the Sicilian from White's side."
  },
  {
    "eco": "A06",
    "name": "Réti Opening",
    "moves": "Nf3 d5",
    "category": "flank",
    "idea": "White develops the knight first and plans g3 + Bg2, fighting for the center from a distance in hypermodern style."
  },
  {
    "eco": "A05",
    "name": "Réti System",
    "moves": "Nf3 Nf6",
    "category": "flank",
    "idea": "A flexible first move that keeps all options open — typical of hypermodern play developed by Richard Réti."
  },
  {
    "eco": "A07",
    "name": "King's Indian Attack",
    "moves": "Nf3 d5 g3",
    "category": "flank",
    "idea": "White builds a King's Indian setup from the White side — solid, versatile, and used by Bobby Fischer against the French."
  },
  {
    "eco": "A00",
    "name": "Bird's Opening",
    "moves": "f4",
    "category": "flank",
    "idea": "White controls e5 immediately with f4. Leads to unique positions related to the Dutch Defense from White's perspective."
  },
  {
    "eco": "A00",
    "name": "Larsen's Opening",
    "moves": "b3",
    "category": "flank",
    "idea": "White prepares a queenside fianchetto. Hypermodern and rare, but effective — used by Bent Larsen to surprise opponents."
  },
  {
    "eco": "A00",
    "name": "Polish Opening",
    "moves": "b4",
    "category": "flank",
    "idea": "An early queenside flank advance, known as the Orangutan Opening. Very rare but disruptive against unprepared opponents."
  }
]

export const ENDGAMES = [
  {
    "id": "kqk-1",
    "title": "K+Q vs K — Basic Checkmate",
    "fen": "8/8/8/8/5k2/6q1/8/7K b - - 0 1",
    "description": "Use your king and major piece to reduce the opposing king’s escape squares. Finish with checkmate, and watch out for stalemate.",
    "goal": "checkmate",
    "goalText": "Checkmate the opponent's king",
    "category": "KQK",
    "difficulty": "beginner"
  },
  {
    "id": "kqk-3",
    "title": "Queen and pawn study 2",
    "fen": "8/8/8/1k6/8/8/1p6/4K2Q b - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "KQK",
    "difficulty": "intermediate",
    "sourceTitle": "K+Q vs K+P — Race"
  },
  {
    "id": "krk-1",
    "title": "K+R vs K — Ladder Mate",
    "fen": "8/8/8/8/8/2k5/8/R1K5 w - - 0 1",
    "description": "Use your king and major piece to reduce the opposing king’s escape squares. Finish with checkmate, and watch out for stalemate.",
    "goal": "checkmate",
    "goalText": "Checkmate with K+R",
    "category": "KRK",
    "difficulty": "beginner"
  },
  {
    "id": "krk-2",
    "title": "K+R vs K — Back Rank Mate",
    "fen": "8/8/8/4k3/8/8/8/R3K3 w - - 0 1",
    "description": "Use your king and major piece to reduce the opposing king’s escape squares. Finish with checkmate, and watch out for stalemate.",
    "goal": "checkmate",
    "goalText": "Checkmate with K+R",
    "category": "KRK",
    "difficulty": "beginner"
  },
  {
    "id": "lucena",
    "title": "Rook and pawn study 5",
    "fen": "1K1k4/1P6/8/8/8/8/r7/4R3 w - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "KRPKR",
    "difficulty": "advanced",
    "sourceTitle": "Lucena Position"
  },
  {
    "id": "philidor",
    "title": "Rook and pawn study 6",
    "fen": "4k3/8/8/4PK2/4r3/8/8/4R3 b - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "KRPKR",
    "difficulty": "advanced",
    "sourceTitle": "Philidor Position — Hold the Draw"
  },
  {
    "id": "kpk-1",
    "title": "King and pawn study 7",
    "fen": "8/8/8/3k4/3P4/3K4/8/8 w - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "KPK",
    "difficulty": "beginner",
    "sourceTitle": "K+P vs K — Opposition"
  },
  {
    "id": "kpk-2",
    "title": "King and pawn study 8",
    "fen": "8/8/8/8/8/k7/p7/K7 b - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "KPK",
    "difficulty": "intermediate",
    "sourceTitle": "K+P vs K — Rook Pawn"
  },
  {
    "id": "kpk-3",
    "title": "King and pawn study 9",
    "fen": "7k/8/8/8/8/8/7P/7K w - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "KPK",
    "difficulty": "intermediate",
    "sourceTitle": "K+P vs K — Stalemate Trick"
  },
  {
    "id": "kpk-4",
    "title": "Pawn coordination study 10",
    "fen": "8/8/4k3/8/3P4/8/8/3K4 w - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "pawn",
    "difficulty": "intermediate",
    "sourceTitle": "Passed Pawn — Key Squares"
  },
  {
    "id": "pawn-breakthrough",
    "title": "Pawn coordination study 11",
    "fen": "8/ppp5/8/PPP5/8/8/8/4K1k1 w - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "pawn",
    "difficulty": "intermediate",
    "sourceTitle": "Pawn Breakthrough"
  },
  {
    "id": "zugzwang-1",
    "title": "Pawn coordination study 12",
    "fen": "8/8/p1k5/8/8/K7/8/8 w - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "pawn",
    "difficulty": "intermediate",
    "sourceTitle": "Zugzwang — Mutual"
  },
  {
    "id": "rook-cut-off",
    "title": "Rook activity study 13",
    "fen": "8/8/8/3k4/8/8/3K4/r2R4 w - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "rook",
    "difficulty": "intermediate",
    "sourceTitle": "Rook Cutoff — Winning Technique"
  },
  {
    "id": "rook-active-king",
    "title": "Rook activity study 14",
    "fen": "5r2/8/5k2/8/8/4K3/8/3R4 w - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "rook",
    "difficulty": "intermediate",
    "sourceTitle": "Active King in Rook Ending"
  },
  {
    "id": "king-march",
    "title": "Pawn coordination study 15",
    "fen": "8/5p2/6k1/8/8/6K1/5P2/8 w - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "pawn",
    "difficulty": "beginner",
    "sourceTitle": "King March in the Endgame"
  },
  {
    "id": "triangulation",
    "title": "Pawn coordination study 16",
    "fen": "8/8/3k4/3P4/8/3K4/8/8 b - - 0 1",
    "description": "Explore king activity, piece coordination and pawn races from this position. This is a practice position, not a certified theoretical win or draw.",
    "goal": "technique",
    "goalText": "Free practice against Stockfish; no forced win is assumed.",
    "category": "pawn",
    "difficulty": "advanced",
    "sourceTitle": "Triangulation"
  }
]
