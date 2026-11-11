import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Chess } from 'chess.js'

export type BotLevel = 'rookie' | 'navigator' | 'captain'
export type Analysis = { move: string | null; score: { type: 'cp' | 'mate'; value: number }; pv: string[] }
const levels = { rookie: { skill: 0, nodes: 12000 }, navigator: { skill: 6, nodes: 45000 }, captain: { skill: 16, nodes: 160000 } }
let running = 0
export class BotError extends Error {
  constructor(public status: 400 | 401 | 429 | 503, message: string) { super(message) }
}

export function readTrainingGame(pgn: string, allowSetup = false) {
  const game = new Chess()
  try { game.loadPgn(pgn) } catch { throw new BotError(400, 'This training position could not be read') }
  if (game.history().length > 600 || (!allowSetup && (game.getHeaders().SetUp || game.getHeaders().FEN))) throw new BotError(400, 'Start training from the standard position; maximum 600 half-moves')
  // Strip all free-form headers/comments before any position is sent to an AI provider.
  const clean = new Chess(allowSetup && game.getHeaders().FEN ? game.getHeaders().FEN : undefined)
  const previous = clean.turn() === 'w' ? 'b' : 'w'
  const king = clean.board().flat().find(piece => piece?.color === previous && piece.type === 'k')!
  if (clean.isAttacked(king.square, clean.turn())) throw new BotError(400, 'This starting position leaves the previous player in check')
  for (const move of game.history({ verbose: true })) clean.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) })
  return clean
}

export async function analyze(fen: string, level?: BotLevel): Promise<Analysis> {
  const game = new Chess(fen)
  if (game.isGameOver()) return { move: null, score: { type: 'cp', value: game.isCheckmate() ? -100000 : 0 }, pv: [] }
  if (running >= 2) throw new BotError(429, 'The training engine is busy. Try again in a moment.')
  const engineFile = process.env.STOCKFISH_JS_PATH || join(dirname(createRequire(import.meta.url).resolve('stockfish/package.json')), 'bin', 'stockfish-19-lite-single.js')
  running++
  let child: ReturnType<typeof Bun.spawn> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    child = Bun.spawn([process.env.NODE_BINARY || 'node', engineFile], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
    const engineProcess = child, settings = level ? levels[level] : { skill: 20, nodes: 140000 }
    return await new Promise<Analysis>((resolve, reject) => {
      timer = setTimeout(() => { engineProcess.kill(); reject(new BotError(503, 'The training engine timed out. Please retry.')) }, 12000)
      let score: Analysis['score'] = { type: 'cp', value: 0 }, pv: string[] = [], buffer = '', started = false
      const write = (command: string) => { (engineProcess.stdin as import('bun').FileSink).write(`${command}\n`) }
      write('uci'); write('setoption name Hash value 16'); write(`setoption name Skill Level value ${settings.skill}`); write('isready')
      void (async () => {
        try {
          const stream = engineProcess.stdout as ReadableStream<Uint8Array>, decoder = new TextDecoder()
          for await (const chunk of stream) {
            buffer += decoder.decode(chunk, { stream: true })
            let end: number
            while ((end = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1)
              if (line === 'readyok' && !started) { started = true; write(`position fen ${fen}`); write(`go nodes ${settings.nodes}`) }
              const evaluation = line.match(/\bscore (cp|mate) (-?\d+)/)
              if (evaluation && !line.includes('lowerbound') && !line.includes('upperbound')) score = { type: evaluation[1] as 'cp' | 'mate', value: Number(evaluation[2]) }
              const variation = line.match(/\bpv (.+)$/)
              if (variation) pv = variation[1]!.trim().split(/\s+/).slice(0, 3)
              if (line.startsWith('bestmove ')) {
                const move = line.split(' ')[1]!
                try { game.move({ from: move.slice(0, 2), to: move.slice(2, 4), ...(move[4] ? { promotion: move[4] } : {}) }) }
                catch { throw new Error('Engine returned an illegal move') }
                resolve({ move, score, pv }); return
              }
            }
          }
          reject(new BotError(503, 'The training engine stopped. Please retry.'))
        } catch { reject(new BotError(503, 'The training engine is unavailable. Please retry.')) }
      })()
    })
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null) child.kill()
    if (child) await child.exited
    running--
  }
}
