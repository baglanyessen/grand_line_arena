// Run from the project root: bun run server/scripts/browser-acceptance.ts
// Requires local PostgreSQL, Playwright, and an installed Chrome/Edge (or BROWSER_TEST_EXECUTABLE).
import { chromium, type Page } from 'playwright'
import postgres from 'postgres'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { Chess } from 'chess.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const namespace = `browser_test_${crypto.randomUUID().replaceAll('-', '')}`
const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/grand_line_arena'
const admin = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice() {} })
const children: ReturnType<typeof Bun.spawn>[] = []
const output = join(root, 'artifacts', 'browser-acceptance')
mkdirSync(output, { recursive: true })
const checks: string[] = [], errors: string[] = [], frames = new Map<Page, any[]>()
const liveCoach = process.env.BROWSER_TEST_LIVE_COACH === '1'
const reportPath = join(output, liveCoach ? 'bot-live-report.json' : process.env.BROWSER_TEST_BOT_ONLY === '1' ? 'bot-report.json' : 'report.json')
let created = false, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const log = (text: string) => { checks.push(text); console.log(`PASS ${text}`) }
const tables = ['users', 'games', 'game_rewards', 'crews', 'crew_members', 'crew_wars', 'war_matches', 'war_fighters', 'war_settlements', 'war_rewards', 'active_engine_owner', 'active_games', 'active_game_players', 'leadership_challenges', 'leadership_matches']

async function until(check: () => Promise<boolean>, message: string, timeout = 20000) {
  const started = Date.now()
  while (!await check()) {
    if (Date.now() - started > timeout) throw new Error(message)
    await Bun.sleep(100)
  }
}
async function serverReady(url: string) {
  await until(async () => { try { return (await fetch(url)).ok } catch { return false } }, `Server did not become ready: ${url}`)
}
function spawn(command: string[], cwd: string, env = process.env) {
  const child = Bun.spawn(command, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  children.push(child)
  void new Response(child.stdout).text().then(text => writeFileSync(join(output, `process-${child.pid}.stdout.log`), text))
  void new Response(child.stderr).text().then(text => writeFileSync(join(output, `process-${child.pid}.stderr.log`), text))
  return child
}
async function button(page: Page, name: string) { await page.getByRole('button', { name, exact: true }).click() }
async function trainingTab(page: Page, name: string) {
  const tab = page.getByRole('button', { name, exact: true })
  await tab.click()
  // dnd-kit's end-of-drag click suppression can swallow a click issued in the same frame.
  if (await tab.getAttribute('aria-pressed') !== 'true') await tab.click()
  await until(async () => await tab.getAttribute('aria-pressed') === 'true', `Training tab did not open: ${name}`)
}
async function visible(page: Page, text: string) { await page.getByText(text, { exact: true }).waitFor({ state: 'visible' }) }
async function register(page: Page, username: string) {
  frames.set(page, [])
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${response.url()}`) })
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/crews/')) {
      if (url.port !== '3301') errors.push(`Incorrect API destination: ${url.origin}${url.pathname}`)
    }
  })
  page.on('websocket', socket => socket.on('framereceived', event => {
    try { frames.get(page)!.push(JSON.parse(String(event.payload))) } catch {}
  }))
  await page.goto('http://127.0.0.1:5173/')
  await page.getByRole('heading', { name: 'The chess arena', exact: true }).waitFor()
  if (await page.getByRole('button', { name: 'Game lobby', exact: true }).count()) throw new Error('Removed lobby still appears in navigation')
  await playMove(page, page, 'e2', 'e4', 'wP')
  await playMove(page, page, 'e7', 'e5', 'bP')
  await button(page, 'Reset')
  await page.locator('[data-square="e2"] [data-piece="wP"]').waitFor()
  await button(page, 'Sign in to play online')
  await button(page, 'Back to play')
  await page.getByRole('heading', { name: 'The chess arena', exact: true }).waitFor()
  await button(page, 'Sign in to play online')
  await button(page, 'Register')
  await page.getByLabel('Username', { exact: true }).fill(username)
  await page.getByLabel('Email', { exact: true }).fill(`${username}@example.test`)
  await page.getByLabel('Password', { exact: true }).fill('Browser-test-only-password-2026!')
  await page.locator('form button[type=submit]').click()
  await page.getByRole('button', { name: 'Crew quarters', exact: true }).waitFor()
  await page.getByRole('heading', { name: 'The chess arena', exact: true }).waitFor()
  await until(async () => page.getByRole('button', { name: 'Find Match', exact: true }).isEnabled(), 'WebSocket never authenticated')
}
async function playMove(player: Page, other: Page, from: string, to: string, piece: string) {
  const source = player.locator(`[data-square="${from}"]`), destination = player.locator(`[data-square="${to}"]`)
  await source.scrollIntoViewIfNeeded()
  const a = await source.boundingBox(), b = await destination.boundingBox()
  assert(a && b, `Missing chess squares ${from}/${to}`)
  await player.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await player.mouse.down()
  await player.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 })
  await player.mouse.up()
  for (const page of [player, other]) await page.locator(`[data-square="${to}"] [data-piece="${piece}"]`).waitFor({ state: 'visible' })
}
async function fourMoves(white: Page, black: Page) {
  await playMove(white, black, 'e2', 'e4', 'wP')
  await playMove(black, white, 'e7', 'e5', 'bP')
  await playMove(white, black, 'g1', 'f3', 'wN')
  await playMove(black, white, 'b8', 'c6', 'bN')
}
async function finish(loser: Page, winner: Page) {
  await button(loser, 'Resign')
  await visible(loser, 'Defeat!'); await visible(winner, 'Victory!')
  await visible(winner, 'Saved to match history.')
  await button(loser, 'Return to Practice'); await button(winner, 'Return to Practice')
}
async function leadership(page: Page) {
  await button(page, 'Crew quarters'); await button(page, "Captain's challenge")
  await page.getByRole('heading', { name: "Who wears the captain's hat?", exact: true }).waitFor()
}

try {
  if (liveCoach) assert(process.env.OPENAI_API_KEY, 'Configure OPENAI_API_KEY before running the live coach check')
  // Refuse to compete with an existing development server; never stop the user's processes.
  for (const port of [3301, 5173]) {
    const net = await import('node:net')
    await new Promise<void>((resolve, reject) => {
      const probe = net.createServer()
      probe.once('error', () => reject(new Error(`Port ${port} is occupied; stop that development server before this test`)))
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()))
    })
  }
  await admin.unsafe(`CREATE SCHEMA "${namespace}"`); created = true
  // Clone structure, constraints and indexes, never application rows. Rebuild FKs inside the isolated schema.
  for (const table of tables) await admin.unsafe(`CREATE TABLE "${namespace}"."${table}" (LIKE public."${table}" INCLUDING ALL)`)
  const foreignKeys = await admin<{ name: string; table_name: string; definition: string }[]>`
    SELECT c.conname AS name, t.relname AS table_name, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'`
  await admin.begin(async tx => {
    await tx.unsafe(`SET LOCAL search_path TO "${namespace}"`)
    for (const fk of foreignKeys.filter(row => tables.includes(row.table_name))) {
      assert(/^[a-z_]+$/.test(fk.name))
      await tx.unsafe(`ALTER TABLE "${fk.table_name}" ADD CONSTRAINT "${fk.name}" ${fk.definition.replaceAll('REFERENCES public.', `REFERENCES "${namespace}".`)}`)
    }
  })
  const isolatedUrl = new URL(databaseUrl); isolatedUrl.searchParams.set('search_path', namespace)
  spawn([process.execPath, 'run', 'scripts/browser-backend.ts'], join(root, 'server'), { ...process.env, PORT: '3301', DATABASE_URL: isolatedUrl.href, BROWSER_TEST_SCHEMA: namespace, JWT_SECRET: `browser-only-${crypto.randomUUID()}`, OPENAI_API_KEY: liveCoach ? process.env.OPENAI_API_KEY : '' })
  spawn(['node', 'server/scripts/browser-vite.mjs'], root)
  await Promise.all([serverReady('http://localhost:3301/'), serverReady('http://127.0.0.1:5173/')])
  const servedApi = await (await fetch('http://127.0.0.1:5173/src/lib/api.js')).text()
  writeFileSync(join(output, 'served-api.js'), servedApi)
  assert(servedApi.includes('http://localhost:3301'), 'Vite did not expose the isolated API configuration')
  const executable = process.env.BROWSER_TEST_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync)
  browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) })
  const captainContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const memberContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const captain = await captainContext.newPage(), member = await memberContext.newPage()
  const suffix = crypto.randomUUID().slice(0, 8), captainName = `Captain_${suffix}`, memberName = `Member_${suffix}`
  await register(captain, captainName); await register(member, memberName)
  assert.deepEqual(errors, [], 'Browser is not using the isolated backend')
  const isolatedAccounts = await admin.unsafe(`SELECT username FROM "${namespace}".users`)
  assert.deepEqual(isolatedAccounts.map(row => row.username).sort(), [captainName, memberName].sort(), 'Accounts escaped the isolated schema')
  log('Two independent browsers register real accounts and authenticate WebSockets')
  await button(member, 'Play with bot')
  await member.getByRole('heading', { name: /A rival on the board/ }).waitFor()
  await member.getByLabel('Only point out important moments').uncheck()
  await member.getByRole('tab', { name: 'Engine chat', exact: true }).click()
  await button(member, 'Best move')
  await member.locator('.mentor-engine-card').first().waitFor()
  await button(member, 'Highlight on board')
  log('Engine chat returns a Stockfish card and highlights its idea on the board')
  const hintResponse = member.waitForResponse(response => response.url().endsWith('/bot/coach') && response.request().method() === 'POST')
  await button(member, 'Hint, please')
  const hint = await (await hintResponse).json()
  assert.equal(hint.source, liveCoach ? 'openai' : 'engine', 'The coaching source did not match this test mode')
  await member.getByText(liveCoach ? /AI MENTOR.*YOUR NEXT IDEA/ : /ENGINE TIP.*YOUR NEXT IDEA/).waitFor()
  if (liveCoach) {
    assert(hint.text.length <= 600, 'The AI hint should stay concise')
    writeFileSync(join(output, 'coach-live.json'), JSON.stringify({ ...hint, testedAt: new Date().toISOString() }, null, 2))
    await member.screenshot({ path: join(output, 'bot-ai-coach.png'), fullPage: true })
    log('Live OpenAI coaching reaches the browser and is labelled AI mentor')
    const lesson = new Chess()
    for (const move of ['d4', 'd5', 'e3', 'Nf6', 'Be2', 'e6', 'Bf3', 'Bd6', 'e4']) lesson.move(move)
    const token = await member.evaluate("localStorage.getItem('gla_token')")
    const reviewResponse = await member.request.post('http://localhost:3301/bot/coach', { headers: { Authorization: `Bearer ${token}` }, data: { pgn: lesson.pgn(), playerColor: 'w', kind: 'review', style: 'cheeky', language: 'en' } })
    assert.equal(reviewResponse.status(), 200)
    const review = await reviewResponse.json()
    assert.equal(review.source, 'openai'); assert(review.text.length <= 600, 'The AI review should stay concise')
    writeFileSync(join(output, 'coach-bishop-live.json'), JSON.stringify({ ...review, testedAt: new Date().toISOString() }, null, 2))
    log('Live OpenAI also explains a verified pawn-blocking-bishop training position')
    await member.getByRole('tab', { name: 'AI chat', exact: true }).click()
    await member.getByLabel('Ask your chess teacher').fill('We are discussing my bishop on f1. Why is it blocked?')
    await button(member, 'Ask teacher')
    await until(async () => await member.locator('.mentor-message.assistant').count() === 1, 'AI chat did not reply', 25000)
    await member.getByLabel('Ask your chess teacher').fill('Which bishop were we discussing?')
    await button(member, 'Ask teacher')
    await until(async () => await member.locator('.mentor-message.assistant').count() === 2, 'AI chat did not retain the conversation', 25000)
    assert.match(await member.locator('.mentor-message.assistant').last().innerText(), /f1|light.squared/i)
    await member.screenshot({ path: join(output, 'ai-conversation.png'), fullPage: true })
    log('Live AI chat answers a board question and remembers the bishop in a follow-up')
  }
  const initialBotBounties = await admin.unsafe(`SELECT id, bounty FROM "${namespace}".users ORDER BY id`)
  const reply = member.waitForResponse(response => response.url().endsWith('/bot/move') && response.request().method() === 'POST')
  await playMove(member, member, 'e2', 'e4', 'wP')
  const response = await reply; assert.equal(response.status(), 200)
  const botMove = (await response.json()).move, expected = new Chess(); expected.move('e4')
  expected.move({ from: botMove.slice(0, 2), to: botMove.slice(2, 4), ...(botMove[4] ? { promotion: botMove[4] } : {}) })
  const moved = expected.get(botMove.slice(2, 4))!
  await member.locator(`[data-square="${botMove.slice(2, 4)}"] [data-piece="${moved.color}${moved.type.toUpperCase()}"]`).waitFor({ state: 'visible' })
  log('Bot mode uses real Stockfish, accepts a human move and shows honestly labelled coaching tips')
  await button(member, 'Play with bot')
  await member.locator('[data-square="e4"] [data-piece="wP"]').waitFor({ state: 'visible' })
  await button(member, 'Take back turn')
  await member.locator('[data-square="e2"] [data-piece="wP"]').waitFor({ state: 'visible' })
  assert.equal(await member.locator('.bot-move-log .ships-log-entry').count(), 0)

  let releaseMove!: () => void, moveArrived!: () => void
  const held = new Promise<void>(resolve => { releaseMove = resolve }), arrived = new Promise<void>(resolve => { moveArrived = resolve })
  await member.route('**/bot/move', async route => { const response = await route.fetch(); moveArrived(); await held; await route.fulfill({ response }) })
  await playMove(member, member, 'e2', 'e4', 'wP'); await arrived
  await button(member, 'Take back turn')
  const released = member.waitForResponse(response => response.url().endsWith('/bot/move'))
  releaseMove(); await released; await member.unroute('**/bot/move')
  await member.waitForTimeout(150)
  await member.locator('[data-square="e2"] [data-piece="wP"]').waitFor({ state: 'visible' })
  assert.equal(await member.locator('.bot-move-log .ships-log-entry').count(), 0)
  log('Bot position survives navigation; takeback cancels stale bot replies without changing the board')
  await member.locator('.bot-setup select').first().selectOption('b')
  const opening = member.waitForResponse(response => response.url().endsWith('/bot/move'))
  await button(member, 'Start new game'); assert.equal((await opening).status(), 200)
  await member.getByText('Your move, Captain.', { exact: true }).waitFor()
  assert(await member.getByRole('button', { name: 'Take back turn', exact: true }).isDisabled())
  await member.screenshot({ path: join(output, 'bot-dojo.png'), fullPage: true })
  await member.setViewportSize({ width: 390, height: 844 })
  await member.screenshot({ path: join(output, 'bot-dojo-mobile.png'), fullPage: true })
  assert(await member.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile bot page overflows horizontally')
  await member.setViewportSize({ width: 1440, height: 1000 })
  await button(member, 'Resign')
  await member.getByText('You resigned. Another voyage awaits.', { exact: true }).waitFor()
  const finalBotBounties = await admin.unsafe(`SELECT id, bounty FROM "${namespace}".users ORDER BY id`)
  assert.deepEqual([...finalBotBounties], [...initialBotBounties])
  log('Playing black starts the bot first; mobile layout and resignation work without awarding bounty')
  await button(member, 'Training deck')
  await playMove(member, member, 'd8', 'h4', 'bQ')
  await visible(member, 'Exercise complete.')
  await member.screenshot({ path: join(output, 'training-puzzle.png'), fullPage: true })
  log('Puzzle training accepts the legal mating solution and marks the drill complete')
  await trainingTab(member, 'Openings')
  await playMove(member, member, 'e2', 'e4', 'wP')
  await member.locator('[data-square="e5"] [data-piece="bP"]').waitFor({ state: 'visible' })
  await visible(member, 'Exercise complete.')
  await member.getByLabel('Practise as').selectOption('b')
  await member.locator('[data-square="e4"] [data-piece="wP"]').waitFor({ state: 'visible' })
  await playMove(member, member, 'e7', 'e5', 'bP'); await visible(member, 'Exercise complete.')
  log('Opening drills work from both sides and supply the opponent replies')
  await trainingTab(member, 'Endgames')
  await member.locator('[data-square="g3"] [data-piece="bQ"]').waitFor({ state: 'visible' })
  const endingReply = member.waitForResponse(response => response.url().endsWith('/bot/study/move'))
  await playMove(member, member, 'g3', 'g4', 'bQ')
  assert.equal((await endingReply).status(), 200)
  await member.locator('[data-square="h2"] [data-piece="wK"]').waitFor({ state: 'visible' })
  await member.screenshot({ path: join(output, 'training-endgame.png'), fullPage: true })
  await member.setViewportSize({ width: 390, height: 844 })
  await member.screenshot({ path: join(output, 'training-mobile.png'), fullPage: true })
  assert(await member.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile training overflows horizontally')
  await member.setViewportSize({ width: 1440, height: 1000 })
  log('Endgame practice uses a custom starting position, real Stockfish replies and a responsive layout')
  await trainingTab(member, 'Mistake review'); await button(member, 'Use current bot game')
  await member.getByText(/0 \/ 0 of your moves analysed/).waitFor()
  log('Mistake review handles an empty player history without inventing mistakes')
  await member.getByText('Review a PGN', { exact: true }).click()
  await member.getByLabel('Training PGN', { exact: true }).fill('1. f3 e5 2. g4 Qh4# 0-1')
  await button(member, 'Load PGN')
  const reviewed: Promise<any>[] = []
  const captureReview = (response: any) => { if (response.url().endsWith('/bot/engine') && response.request().postDataJSON()?.action === 'review') reviewed.push(response.json()) }
  member.on('response', captureReview)
  await button(member, 'Analyse next 6 moves')
  await member.getByText(/2 \/ 2 of your moves analysed/).waitFor()
  member.off('response', captureReview)
  const mistakes = (await Promise.all(reviewed)).filter(result => result.review && ['mistake', 'blunder'].includes(result.review.quality))
  assert(mistakes.length > 0, 'The engine missed the mating blunder')
  await member.getByRole('heading', { name: 'Find the engine alternative', exact: true }).waitFor()
  const alternative = mistakes[0].review, alternativeBoard = new Chess(alternative.beforeFen), alternativePiece = alternativeBoard.get(alternative.bestMove.slice(0, 2))!
  await playMove(member, member, alternative.bestMove.slice(0, 2), alternative.bestMove.slice(2, 4), `${alternativePiece.color}${alternativePiece.type.toUpperCase()}`)
  await visible(member, 'Exercise complete.')
  await member.screenshot({ path: join(output, 'training-blunder-solved.png'), fullPage: true })
  log('Mistake review detects a real mating blunder and turns its engine alternative into a solvable drill')
  await button(member, 'Play chess')
  if (process.env.BROWSER_TEST_BOT_ONLY !== '1') {
  await button(captain, 'Find Match'); await button(member, 'Find Match')
  await until(async () => [captain, member].every(page => frames.get(page)!.some(row => row.type === 'game_start')), 'Ordinary matchmaking did not start')
  const ordinary = frames.get(captain)!.find(row => row.type === 'game_start')
  const white = ordinary.color === 'w' ? captain : member, black = white === captain ? member : captain
  await fourMoves(white, black); await finish(black, white)
  log('Ordinary match: four UI moves synchronize both boards, resignation and saved bounty arrive')

  await button(captain, 'Crew quarters'); await button(captain, 'Create Crew')
  const crewName = `Browser Pirates ${suffix}`
  await captain.getByPlaceholder('Straw Hat Pirates').fill(crewName)
  await captain.getByPlaceholder('SHP', { exact: true }).fill(`T${suffix}`)
  await captain.locator('form').getByRole('button', { name: 'Create', exact: true }).click()
  await visible(captain, crewName)
  await button(member, 'Crew quarters'); await button(member, 'Browse Crews')
  await member.getByText(crewName, { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Join', exact: true }).click()
  await visible(member, crewName)
  log('Captain creates a crew and second account joins through the UI')
  await leadership(member); await button(member, 'Challenge the captain'); await button(member, 'Confirm')
  await visible(member, 'pending')
  await leadership(captain); await button(captain, 'Accept series'); await button(captain, 'Confirm')
  await visible(captain, 'active'); await visible(member, 'active')
  log('Challenge, confirmation and captain acceptance work through the UI')

  for (let round = 1; round <= 2; round++) {
    const before = frames.get(captain)!.filter(row => row.type === 'game_start').length
    await button(captain, 'Enter leadership match'); await button(member, 'Enter leadership match')
    await until(async () => frames.get(captain)!.filter(row => row.type === 'game_start').length > before, `Leadership round ${round} did not start`)
    const start = frames.get(captain)!.filter(row => row.type === 'game_start').at(-1)
    assert.equal(start.color, round === 1 ? 'b' : 'w')
    assert.equal(start.leadershipMatchId, start.gameId)
    await fourMoves(round === 1 ? member : captain, round === 1 ? captain : member)
    if (round === 1) {
      await member.reload(); await button(member, 'Play chess')
      await member.locator('[data-square="c6"] [data-piece="bN"]').waitFor({ state: 'visible' })
      await until(async () => frames.get(member)!.some(row => row.type === 'game_resumed' && row.leadershipMatchId === start.gameId && row.ply === 4), 'Leadership page reload did not restore its position')
      log('Page reload restores the leadership board, assigned color and all four moves')
    }
    await captain.screenshot({ path: join(output, `round-${round}.png`), fullPage: true })
    await finish(captain, member)
    await leadership(captain); await leadership(member)
    log(`Leadership round ${round}: alternating colors, played moves, result and saved history`)
  }
  await visible(member, 'completed'); await visible(member, `${memberName} takes the captain’s hat.`)
  await member.screenshot({ path: join(output, 'leadership-completed.png'), fullPage: true })
  const state = await admin.unsafe(`SELECT c.captain_id, u.username FROM "${namespace}".crews c JOIN "${namespace}".users u ON u.id = c.captain_id`)
  assert.equal(state[0]?.username, memberName)
  const roles = await admin.unsafe(`SELECT u.username, m.role FROM "${namespace}".crew_members m JOIN "${namespace}".users u ON u.id = m.user_id`)
  assert.equal(roles.find(row => row.username === captainName)?.role, 'officer')
  assert.equal(roles.find(row => row.username === memberName)?.role, 'captain')
  await button(member, 'My Crew'); await member.getByRole('button', { name: 'Disband crew', exact: true }).waitFor()
  await button(captain, 'My Crew'); assert.equal(await captain.getByRole('button', { name: 'Disband crew', exact: true }).count(), 0)
  log('Deciding result changes the database captain, both roles and visible captain permissions')
  await member.reload(); await leadership(member)
  await visible(member, 'completed')
  log('Completed series remains visible after a fresh page load')
  await member.setViewportSize({ width: 390, height: 844 })
  await member.screenshot({ path: join(output, 'leadership-mobile.png'), fullPage: true })
  assert(await member.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile page overflows horizontally')
  log('Mobile leadership screen has no horizontal overflow')
  await member.setViewportSize({ width: 1440, height: 1000 })

  await button(captain, 'My Crew'); await button(captain, 'Leave Crew')
  await button(captain, 'Create Crew')
  const rivalName = `Browser Rivals ${suffix}`
  await captain.getByPlaceholder('Straw Hat Pirates').fill(rivalName)
  await captain.getByPlaceholder('SHP', { exact: true }).fill(`R${suffix}`)
  await captain.locator('form').getByRole('button', { name: 'Create', exact: true }).click()
  await visible(captain, rivalName)
  await button(member, 'Crew Wars'); await button(member, 'Challenge a crew')
  await member.getByRole('combobox').selectOption({ label: `${rivalName} (#R${suffix.toUpperCase()})` })
  await member.getByLabel('Fighters per side', { exact: true }).fill('1')
  await button(member, 'Send challenge')
  await button(captain, 'Crew Wars'); await button(captain, 'Accept challenge'); await button(captain, 'Confirm')
  for (const page of [member, captain]) {
    await button(page, 'Fighter rosters & pairings')
    await page.getByRole('checkbox').check()
    await button(page, 'Submit roster')
  }
  log('Crew war: rival creation, challenge, acceptance and one-player rosters work through the UI')
  const previousWarStarts = frames.get(member)!.filter(row => row.type === 'game_start').length
  await button(member, 'Enter war match'); await button(captain, 'Enter war match')
  await until(async () => frames.get(member)!.filter(row => row.type === 'game_start').length > previousWarStarts, 'War board did not start')
  const warStart = frames.get(member)!.filter(row => row.type === 'game_start').at(-1)
  assert.equal(warStart.color, 'w'); assert.equal(warStart.warMatchId, warStart.gameId)
  await fourMoves(member, captain); await finish(captain, member)
  await button(member, 'Crew quarters'); await button(member, 'Crew Wars')
  await visible(member, 'Your crew won this war.')
  const warRewards = await admin.unsafe(`SELECT delta FROM "${namespace}".war_rewards ORDER BY delta DESC`)
  assert.deepEqual(warRewards.map(row => row.delta), [200, 0])
  const warState = await admin.unsafe(`SELECT status, challenger_score_half, defender_score_half FROM "${namespace}".crew_wars`)
  assert.equal(warState[0]?.status, 'completed'); assert.equal(warState[0]?.challenger_score_half, 2)
  await member.screenshot({ path: join(output, 'war-completed.png'), fullPage: true })
  log('Crew war: played board completes the war, persists its score and pays exactly +200/0 war bounty')
  await button(member, "Captain's log")
  await member.locator('.history-row').first().click()
  await member.getByRole('heading', { name: 'Battle replay', exact: true }).waitFor()
  await button(member, 'Final position')
  await member.locator('[data-square="c6"] [data-piece="bN"]').waitFor({ state: 'visible' })
  await member.screenshot({ path: join(output, 'history-replay.png'), fullPage: true })
  log('Saved match history opens a replay and reconstructs its final position')
  await button(member, 'Training deck'); await trainingTab(member, 'Mistake review')
  const choices = member.getByLabel('Recent saved game')
  const gameId = await choices.locator('option').nth(1).getAttribute('value')
  await choices.selectOption(gameId!); await button(member, 'Load game'); await button(member, 'Analyse next 6 moves')
  await member.getByText(/2 \/ 2 of your moves analysed/).waitFor()
  await member.screenshot({ path: join(output, 'training-review.png'), fullPage: true })
  log('Mistake review loads a real saved match and completes its own-move analysis batch')
  }
  assert.deepEqual(errors, [], 'Browser runtime/server errors occurred')
  log('No browser runtime errors or HTTP 5xx responses across the complete flow')
  writeFileSync(reportPath, JSON.stringify({ status: 'passed', checks, errors, testedAt: new Date().toISOString() }, null, 2))
} catch (error) {
  writeFileSync(reportPath, JSON.stringify({ status: 'failed', checks, errors, failure: String(error), testedAt: new Date().toISOString() }, null, 2))
  if (browser) for (const [index, context] of browser.contexts().entries()) for (const page of context.pages()) {
    await page.screenshot({ path: join(output, `failure-${index}.png`), fullPage: true }).catch(() => {})
    writeFileSync(join(output, `failure-${index}.txt`), await page.locator('body').innerText().catch(() => 'Page unavailable'))
  }
  throw error
} finally {
  await browser?.close()
  for (const child of children) { if (child.exitCode === null) child.kill(); await child.exited }
  if (created) {
    assert(/^browser_test_[a-f0-9]{32}$/.test(namespace), 'Unsafe test schema cleanup')
    await admin.unsafe(`DROP SCHEMA "${namespace}" CASCADE`)
  }
  await admin.end()
}
