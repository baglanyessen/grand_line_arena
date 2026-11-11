import { leadershipRoutes } from './routes/leadership'
import { botRoutes } from './routes/bot'
import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { authRoutes } from './routes/auth'
import { crewRoutes } from './routes/crew'
import { warRoutes } from './routes/war'
import { chessWs } from './ws/chess'
import { gameRoutes } from './routes/games'
import { playerRoutes } from './routes/players'
import { createWarDeadlineWorker } from './ws/warDeadlineWorker'

const app = new Elysia()
  .use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'],
    credentials: true,
  }))

  // Health check
  .get('/', ({ set }) => {
    const ready = chessWs.decorator.isGameStorageReady()
    set.status = ready ? 200 : 503
    return { name: 'Grand Line Arena API', version: '1.0.0', status: ready ? 'sailing' : 'game_storage_unavailable' }
  })

  // Routes
  .use(authRoutes)
  .use(botRoutes)
  .use(crewRoutes)
  .use(leadershipRoutes)
  .use(warRoutes)
  .use(gameRoutes)
  .use(playerRoutes)

  // WebSocket
  .use(chessWs)
  .use(createWarDeadlineWorker(chessWs.decorator.isWarMatchProtected, chessWs.decorator.refreshWarWaiting, chessWs.decorator.gameStorageReady, chessWs.decorator.gameStorageOwner))

  .listen(Number(process.env.PORT || 3001))

console.log(`
⚓ Grand Line Arena API
🌊 Server running at http://localhost:${app.server?.port}
🔌 WebSocket at ws://localhost:${app.server?.port}/ws/chess
`)
