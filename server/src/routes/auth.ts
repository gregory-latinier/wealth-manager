import { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcryptjs'
import { getPasswordHash } from '../lib/config'
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSession,
  deleteSessionForRequest,
  getSession,
  renewSessionIfNeeded,
  sessionCookieOptions,
} from '../lib/auth'

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/login',
    {
      // Stricter than the app-wide limit: this is the only route an attacker can brute-force.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['password'],
          properties: {
            // bcrypt only reads the first 72 bytes, and a huge body would make hashing needlessly slow.
            password: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const { password } = request.body as { password: string }

      const valid = await bcrypt.compare(password, getPasswordHash())
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid password' })
      }

      const { token } = await createSession()
      reply.setCookie(SESSION_COOKIE, token, { ...sessionCookieOptions(), maxAge: SESSION_MAX_AGE_SECONDS })
      return reply.send({ success: true })
    }
  )

  fastify.get('/me', async (request, reply) => {
    const session = await getSession(request)
    if (!session) {
      return reply.status(401).send({ authenticated: false })
    }

    const renewedUntil = await renewSessionIfNeeded(session)
    if (renewedUntil) {
      reply.setCookie(SESSION_COOKIE, request.cookies[SESSION_COOKIE]!, {
        ...sessionCookieOptions(),
        maxAge: SESSION_MAX_AGE_SECONDS,
      })
    }
    return reply.send({ authenticated: true })
  })

  fastify.post('/logout', async (request, reply) => {
    await deleteSessionForRequest(request)
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions())
    return reply.send({ success: true })
  })
}
