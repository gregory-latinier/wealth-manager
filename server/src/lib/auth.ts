import crypto from 'crypto'
import { FastifyReply, FastifyRequest } from 'fastify'
import { query } from '../db/index'

export const SESSION_COOKIE = 'wm_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days
export const SESSION_RENEW_AFTER_SECONDS = 60 * 60 * 24 // slide the expiry at most once a day

export function sessionCookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
  }
}

export function generateId(prefix = 'c'): string {
  return prefix + crypto.randomBytes(12).toString('hex')
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export interface Session {
  id: string
  expiresAt: Date
}

/** Creates a session and returns the raw token, which only ever lives in the cookie. */
export async function createSession(): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)

  // Opportunistic cleanup keeps the table tiny without a scheduled job.
  await query(`DELETE FROM "Session" WHERE "expiresAt" < NOW()`)
  await query(`INSERT INTO "Session" ("id", "tokenHash", "expiresAt") VALUES ($1, $2, $3)`, [
    generateId('se'),
    hashToken(token),
    expiresAt,
  ])
  return { token, expiresAt }
}

export async function getSession(request: FastifyRequest): Promise<Session | null> {
  const token = request.cookies[SESSION_COOKIE]
  if (!token) return null

  const res = await query<Session>(
    `SELECT "id", "expiresAt" FROM "Session" WHERE "tokenHash" = $1 AND "expiresAt" > NOW() LIMIT 1`,
    [hashToken(token)]
  )
  return res.rows[0] ?? null
}

/** Slides the expiry forward (at most once a day) so the session lasts as long as the app is used. */
export async function renewSessionIfNeeded(session: Session): Promise<Date | null> {
  const renewBefore = Date.now() + (SESSION_MAX_AGE_SECONDS - SESSION_RENEW_AFTER_SECONDS) * 1000
  if (new Date(session.expiresAt).getTime() >= renewBefore) return null

  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
  await query(`UPDATE "Session" SET "expiresAt" = $1 WHERE "id" = $2`, [expiresAt, session.id])
  return expiresAt
}

export async function deleteSessionForRequest(request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE]
  if (!token) return
  await query(`DELETE FROM "Session" WHERE "tokenHash" = $1`, [hashToken(token)])
}

/** Fastify preHandler: add it to every route that needs a logged-in owner. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = await getSession(request)
  if (!session) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
}
