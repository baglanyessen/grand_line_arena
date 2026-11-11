import { jwt } from '@elysiajs/jwt'

const developmentSecret = 'grand-line-arena-secret-key-change-in-production'
const secret = process.env.JWT_SECRET || developmentSecret

if (process.env.NODE_ENV === 'production' && secret === developmentSecret) {
  throw new Error('Set JWT_SECRET before starting the production server')
}

// HTTP login and WebSocket authentication must use the same signing key.
export const authJwt = jwt({ name: 'jwt', secret, exp: '7d' })
