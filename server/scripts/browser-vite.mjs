import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

// Test-only configuration: do not depend on the invoking shell's environment handling.
const server = await createServer({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify('http://localhost:3301'),
    'import.meta.env.VITE_WS_URL': JSON.stringify('ws://localhost:3301/ws/chess'),
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
await server.listen()
