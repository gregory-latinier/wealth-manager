import { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth'
import { Decimal } from '../lib/money'
import { MAX_TEXT_LENGTH, createLoan, deleteLoan, getLoan, lastValues, listLoans, updateLoan } from '../sources/crowdlending/loans'

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const

// A plain positive-or-zero decimal with at most 2 decimals, such as 500 or 1250.50.
const AMOUNT = /^\d{1,18}(\.\d{1,2})?$/
const amountSchema = { type: 'string', minLength: 1, maxLength: 24 } as const
const AMOUNT_ERROR = 'The amount must be a number with at most 2 decimals, for example 500 or 1250.50'
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const dateSchema = { type: 'string', minLength: 10, maxLength: 10 } as const
const DATE_ERROR = 'The refund date must be a real date written YYYY-MM-DD'

const textSchema = { type: 'string', minLength: 1, maxLength: MAX_TEXT_LENGTH } as const

/** True for a real calendar date. 2026-02-30 matches the pattern but is not one. */
function validDate(value: string): boolean {
  const m = DATE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

export const adminCrowdlendingRoutes: FastifyPluginAsync = async (fastify) => {
  // Every admin route needs a session.
  fastify.addHook('preHandler', requireAuth)

  fastify.get('/loans', async () => {
    const [loans, values] = await Promise.all([listLoans(), lastValues()])
    return { loans: loans.map((l) => ({ ...l, lastValue: values.get(l.id) ?? null })) }
  })

  fastify.post(
    '/loans',
    {
      schema: {
        body: {
          type: 'object',
          required: ['platform', 'name', 'lent', 'dueDate'],
          additionalProperties: false,
          properties: { platform: textSchema, name: textSchema, lent: amountSchema, outstanding: amountSchema, dueDate: dateSchema },
        },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { platform: string; name: string; lent: string; outstanding?: string; dueDate: string }
      const platform = body.platform.trim()
      const name = body.name.trim()
      if (!platform) return reply.status(400).send({ error: 'Give the platform, for example 8lends' })
      if (!name) return reply.status(400).send({ error: 'Give the project a name' })
      const lent = body.lent.trim()
      if (!AMOUNT.test(lent) || new Decimal(lent).isZero()) return reply.status(400).send({ error: 'The amount lent must be greater than 0, with at most 2 decimals' })
      // Nothing is repaid yet when the loan is added, unless the owner says otherwise.
      const outstanding = body.outstanding?.trim() ?? lent
      if (!AMOUNT.test(outstanding)) return reply.status(400).send({ error: AMOUNT_ERROR })
      if (new Decimal(outstanding).gt(lent)) return reply.status(400).send({ error: 'The outstanding amount cannot be more than what was lent' })
      if (!validDate(body.dueDate)) return reply.status(400).send({ error: DATE_ERROR })
      const created = await createLoan({ platform, name, lent, outstanding, dueDate: body.dueDate })
      return reply.status(201).send(created)
    }
  )

  fastify.patch(
    '/loans/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { platform: textSchema, name: textSchema, outstanding: amountSchema, dueDate: dateSchema, active: { type: 'boolean' } },
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = request.body as { platform?: string; name?: string; outstanding?: string; dueDate?: string; active?: boolean }
      const platform = body.platform?.trim()
      const name = body.name?.trim()
      if (body.platform !== undefined && !platform) return reply.status(400).send({ error: 'Give the platform, for example 8lends' })
      if (body.name !== undefined && !name) return reply.status(400).send({ error: 'Give the project a name' })
      const outstanding = body.outstanding?.trim()
      if (outstanding !== undefined && !AMOUNT.test(outstanding)) return reply.status(400).send({ error: AMOUNT_ERROR })
      if (body.dueDate !== undefined && !validDate(body.dueDate)) return reply.status(400).send({ error: DATE_ERROR })

      const existing = await getLoan(id)
      if (!existing) return reply.status(404).send({ error: 'Loan not found' })
      if (outstanding !== undefined && new Decimal(outstanding).gt(existing.lent)) {
        return reply.status(400).send({ error: 'The outstanding amount cannot be more than what was lent' })
      }
      const updated = await updateLoan(id, { platform, name, outstanding, dueDate: body.dueDate, active: body.active })
      if (!updated) return reply.status(404).send({ error: 'Loan not found' })
      return updated
    }
  )

  fastify.delete('/loans/:id', { schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await deleteLoan(id))) return reply.status(404).send({ error: 'Loan not found' })
    return reply.status(204).send()
  })
}
