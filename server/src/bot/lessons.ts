// Lesson/threat-card separation inspired by Iamsdt/chess. Board facts use chess.js attackers,
// not legal moves for the side to move, so opponent attacks are not silently missed.
import { Chess, type Color, type Square } from 'chess.js'
import { boardFacts, type TeachingContext, type CoachLanguage } from './coach'

export type Lesson = { id: string; title: string; text: string; squares: string[]; fen: string; arrows: { startSquare: string; endSquare: string; color: string }[] }
const names: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }
const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 }

export function chooseLesson(game: Chess, color: Color, language: CoachLanguage, context?: TeachingContext): Lesson | null {
  const ru = language === 'ru', enemy = color === 'w' ? 'b' : 'w', board = game.board().flat().filter(piece => piece !== null)
  const card = (id: string, title: string, text: string, squares: string[], from?: string, to?: string): Lesson => ({ id, title, text, squares, fen: game.fen(), arrows: from && to ? [{ startSquare: from, endSquare: to, color: '#c43f38' }] : [] })
  if (game.isGameOver()) return card('game-over', ru ? 'Партия окончена' : 'Game over', game.isCheckmate() ? ru ? 'Мат. Верни ход и проверь, где король потерял пути отступления.' : 'Checkmate. Take back a turn and look for the king’s escape squares.' : ru ? 'Ничья. Можно разобрать позицию или начать заново.' : 'A draw. You can explore the position or start again.', [])
  if (game.isCheck() && game.turn() === color) {
    const king = board.find(piece => piece.color === color && piece.type === 'k')!
    const attacker = game.attackers(king.square, enemy)[0]
    return card(`check:${king.square}`, ru ? 'Шах королю' : 'Your king is in check', ru ? `Сначала защити короля на ${king.square}: уйди, закрой линию или забери шахующую фигуру.` : `Your king on ${king.square} needs a reply now: move it, block the line, or capture the attacker.`, [king.square, ...(attacker ? [attacker] : [])], attacker, king.square)
  }
  const last = game.history({ verbose: true }).at(-1)
  if (last?.color === enemy) {
    const targets = board.filter(piece => piece.color === color && values[piece.type]! >= 3 && game.attackers(piece.square, enemy).includes(last.to))
    if (targets.length >= 2) return card(`fork:${last.to}:${targets.map(piece => piece.square).join(':')}`, ru ? 'Двойная атака' : 'One piece, two targets', ru ? `Фигура на ${last.to} атакует ${targets.map(piece => piece.square).join(' и ')}. Ищи ход, который отвечает сразу на обе угрозы.` : `The ${names[last.piece]} on ${last.to} attacks ${targets.map(piece => `${names[piece.type]} on ${piece.square}`).join(' and ')}. Look for a reply that handles both threats.`, [last.to, ...targets.map(piece => piece.square)], last.to, targets[0]!.square)
  }
  const exposed = board.filter(piece => piece.color === color && piece.type !== 'k' && game.isAttacked(piece.square, enemy) && !game.isAttacked(piece.square, color)).sort((a, b) => values[b.type]! - values[a.type]!)
  if (exposed[0]) {
    const piece = exposed[0], attacker = game.attackers(piece.square, enemy)[0]!
    return card(`undefended:${piece.square}:${attacker}`, ru ? 'Атакованная фигура' : 'An undefended target', ru ? `Фигура на ${piece.square} атакована с ${attacker} и не защищена. Проверь взятие и возможные связки, прежде чем игнорировать угрозу.` : `Your ${names[piece.type]} on ${piece.square} is attacked from ${attacker} and has no defender. Check the capture and any pins before ignoring it.`, [attacker, piece.square], attacker, piece.square)
  }
  for (const attacker of board.filter(piece => piece.color === enemy && ['r', 'b', 'q'].includes(piece.type))) {
    const rays = attacker.type === 'b' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : attacker.type === 'r' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]
    for (const [dx, dy] of rays) {
      let file = attacker.square.charCodeAt(0) + dx!, rank = Number(attacker.square[1]) + dy!, first: Square | null = null
      while (file >= 97 && file <= 104 && rank >= 1 && rank <= 8) {
        const square = `${String.fromCharCode(file)}${rank}` as Square, piece = game.get(square)
        if (piece) {
          if (piece.color !== color) break
          if (!first && piece.type !== 'k') first = square
          else { if (first && piece.type === 'k') return card(`pin:${attacker.square}:${first}:${square}`, ru ? 'Связка к королю' : 'Pinned to the king', ru ? `Фигура на ${first} прикрывает короля от линии ${attacker.square}–${square}. Уход с этой линии откроет шах.` : `Your piece on ${first} shields the king from the line ${attacker.square}–${square}. Moving off that line would expose check.`, [attacker.square, first, square], attacker.square, first); break }
        }
        file += dx!; rank += dy!
      }
    }
  }
  if (context && 'newBlockedDiagonals' in context) {
    const blocked = context.newBlockedDiagonals?.find(fact => boardFacts(game, color).blocked.includes(fact))
    if (blocked) {
      const [pawn, bishop] = blocked.match(/[a-h][1-8]/g)!
      return card(`blocked-bishop:${pawn}:${bishop}`, ru ? 'Своя пешка перекрывает диагональ' : 'Your pawn blocks a diagonal', ru ? `Пешка на ${pawn} перекрыла диагональ слону на ${bishop}. Проверь, есть ли у него другой полезный путь.` : `Your pawn on ${pawn} cuts off the bishop on ${bishop} along this diagonal. Check whether that bishop has another useful route.`, [pawn!, bishop!], bishop, pawn)
    }
  }
  return null
}

export function recommendationCard(game: Chess, context: TeachingContext, language: CoachLanguage): Lesson {
  const move = context.preferredMove, ru = language === 'ru'
  if (!move) return { id: 'finished', title: ru ? 'Нет продолжения' : 'No continuation', text: ru ? 'Позиция завершена.' : 'This position is finished.', squares: [], fen: game.fen(), arrows: [] }
  const before = context.kind === 'review', text = move.openedDiagonals[0] ?? (move.givesCheck ? 'The check forces a response before the opponent can continue their plan.' : ['n', 'b'].some(piece => names[piece] === move.piece) && ['1', '8'].includes(move.from[1]!) ? 'It brings a minor piece off its starting rank and into play.' : move.captured ? `This continuation captures a ${move.captured}; check the reply before assuming it wins material.` : 'The short search prefers this continuation. Inspect the reply before choosing it.')
  return { id: `recommendation:${move.uci}`, title: before ? ru ? 'Альтернатива перед твоим ходом' : 'An alternative before your move' : ru ? 'Идея движка' : 'Engine idea',
    text: ru ? `${before ? 'До твоего хода' : 'В этой позиции'} движок предлагает ${move.san}. Проверь короткое продолжение на доске.` : `${before ? 'Before your move, consider' : 'Consider'} ${move.san}. ${text}`,
    squares: [move.from, move.to], fen: before ? new Chess(game.history({ verbose: true }).findLast(move => move.color === context.playerColor)!.before).fen() : game.fen(),
    arrows: [{ startSquare: move.from, endSquare: move.to, color: '#1d8979' }] }
}
