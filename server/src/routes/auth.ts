import { Elysia, t } from 'elysia'
import { authJwt } from '../auth/jwt'
import { db } from '../db'
import { users } from '../db/schema'
import { eq } from 'drizzle-orm'

export const authRoutes = new Elysia({ prefix: '/auth' })
  .use(authJwt)

  /* ─── Register ──────────────────────────────────────── */
  .post(
    '/register',
    async ({ body, jwt, set }) => {
      const { username, email, password } = body

      // Check if user already exists
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1)

      if (existing.length > 0) {
        set.status = 409
        return { error: 'Email already registered' }
      }

      const existingUsername = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1)

      if (existingUsername.length > 0) {
        set.status = 409
        return { error: 'Username already taken' }
      }

      // Hash password
      const passwordHash = await Bun.password.hash(password, {
        algorithm: 'bcrypt',
        cost: 10,
      })

      // Create user
      const [user] = await db
        .insert(users)
        .values({
          username,
          email,
          passwordHash,
        })
        .returning({
          id: users.id,
          username: users.username,
          email: users.email,
          rating: users.rating,
          bounty: users.bounty,
          bountyVersion: users.bountyVersion,
        })

      if (!user) {
        set.status = 500
        return { error: 'Failed to create user' }
      }

      const token = await jwt.sign({ sub: user.id, username: user.username })

      return { user, token }
    },
    {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 32 }),
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 6 }),
      }),
    }
  )

  /* ─── Login ─────────────────────────────────────────── */
  .post(
    '/login',
    async ({ body, jwt, set }) => {
      const { email, password } = body

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1)

      if (!user) {
        set.status = 401
        return { error: 'Invalid credentials' }
      }

      const valid = await Bun.password.verify(password, user.passwordHash)
      if (!valid) {
        set.status = 401
        return { error: 'Invalid credentials' }
      }

      const token = await jwt.sign({ sub: user.id, username: user.username })

      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          rating: user.rating,
          bounty: user.bounty,
          bountyVersion: user.bountyVersion,
          avatarUrl: user.avatarUrl,
        },
        token,
      }
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String(),
      }),
    }
  )

  /* ─── Get Current User ──────────────────────────────── */
  .get(
    '/me',
    async ({ headers, jwt, set }) => {
      const authHeader = headers.authorization
      if (!authHeader?.startsWith('Bearer ')) {
        set.status = 401
        return { error: 'Not authenticated' }
      }

      const token = authHeader.slice(7)
      const payload = await jwt.verify(token)

      if (!payload) {
        set.status = 401
        return { error: 'Invalid token' }
      }

      const [user] = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          rating: users.rating,
          bounty: users.bounty,
          bountyVersion: users.bountyVersion,
          avatarUrl: users.avatarUrl,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, payload.sub as string))
        .limit(1)

      if (!user) {
        set.status = 404
        return { error: 'User not found' }
      }

      return { user }
    }
  )
