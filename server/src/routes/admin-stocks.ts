import { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth'
import { Decimal } from '../lib/money'
import { ProviderError } from '../sources/crypto/providers/types'
import { reasonOf } from '../sources/smardex/ownership'
import { MAX_TEXT_LENGTH, createHolding, deleteHolding, getHolding, lastValues, listHoldings, updateHolding, type StockCurrency } from '../sources/stocks/holdings'
import { UnknownSymbolError, createYahooQuotes, createYahooSearch, type QuoteProvider, type SymbolSearch } from '../sources/stocks/yahoo'

export interface AdminStocksOptions {
  /** Overridable for tests. Defaults to Yahoo Finance. Reads the name and currency of a listing when it is added. */
  quotes?: QuoteProvider
  /** Overridable for tests. Defaults to Yahoo Finance. Finds tickers by name. */
  search?: SymbolSearch
}

/** One listing found by name. Currency and price come from its own quote. They are null when the quote could not be read. */
export interface SearchResult {
  symbol: string
  name: string
  type: string
  exchange: string
  currency: string | null
  price: string | null
  /** True when the listing can be added: quoted in EUR or USD. */
  supported: boolean
  /** Why it cannot be added. */
  reason: string | null
}

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const

// A Yahoo ticker: letters, digits and a few separators, such as JEQP.DE, BRK-B or ^GSPC. The exchange is the suffix after the dot.
const SYMBOL = /^[A-Z0-9][A-Z0-9.\-=^]{0,19}$/
// A plain decimal such as 12 or 3.5. No exponent, no sign: the column holds 6 decimals (fractional shares) and 14 digits before the point.
const QUANTITY = /^\d{1,14}(\.\d{1,6})?$/
const quantitySchema = { type: 'string', minLength: 1, maxLength: 24 } as const
const SUPPORTED: readonly string[] = ['EUR', 'USD']
const MAX_SEARCH_RESULTS = 8

/** Normalised quantity, or null when it is not a positive plain decimal. */
function parseQuantity(input: string): string | null {
  const text = input.trim()
  if (!QUANTITY.test(text) || new Decimal(text).isZero()) return null
  return text
}

const QUANTITY_ERROR = 'The quantity must be a number greater than 0, with at most 6 decimals'

export const adminStocksRoutes: FastifyPluginAsync<AdminStocksOptions> = async (fastify, options) => {
  // Every admin route needs a session.
  fastify.addHook('preHandler', requireAuth)

  const quotes = options.quotes ?? createYahooQuotes()
  const search = options.search ?? createYahooSearch()

  fastify.get('/holdings', async () => {
    const [holdings, values] = await Promise.all([listHoldings(), lastValues()])
    return { holdings: holdings.map((h) => ({ ...h, lastValue: values.get(h.id) ?? null })) }
  })

  // Finds tickers by name, ticker or ISIN. Each hit is priced, because the search does not say which currency a listing is quoted in.
  fastify.get(
    '/search',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          additionalProperties: false,
          properties: { q: { type: 'string', minLength: 2, maxLength: 60 } },
        },
      },
      // One search is up to 8 more requests to Yahoo, so the limit is tight.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const text = (request.query as { q: string }).q.trim()
      if (text.length < 2) return reply.status(400).send({ error: 'Type at least 2 characters' })

      let hits
      try {
        hits = (await search.search(text)).slice(0, MAX_SEARCH_RESULTS)
      } catch (err) {
        request.log.warn({ err: reasonOf(err) }, 'ticker search failed')
        return reply.status(502).send({ error: `Could not search for tickers: ${reasonOf(err)}` })
      }

      const results = await Promise.all(
        hits.map(async (hit): Promise<SearchResult> => {
          try {
            const quote = await quotes.getQuote(hit.symbol)
            const supported = SUPPORTED.includes(quote.currency)
            return {
              ...hit,
              currency: quote.currency,
              price: quote.price.toFixed(),
              supported,
              reason: supported ? null : `Quoted in ${quote.currency}, only EUR and USD are supported`,
            }
          } catch (err) {
            const reason = err instanceof UnknownSymbolError ? 'No price available' : `Price unavailable: ${reasonOf(err)}`
            return { ...hit, currency: null, price: null, supported: false, reason }
          }
        })
      )
      // Listings that can be added come first, in the order of the search (best match first).
      return { results: [...results.filter((r) => r.supported), ...results.filter((r) => !r.supported)] }
    }
  )

  fastify.post(
    '/holdings',
    {
      schema: {
        body: {
          type: 'object',
          required: ['symbol', 'quantity'],
          additionalProperties: false,
          properties: {
            symbol: { type: 'string', minLength: 1, maxLength: 30 },
            broker: { type: 'string', maxLength: MAX_TEXT_LENGTH },
            quantity: quantitySchema,
          },
        },
      },
      // Reads a price from Yahoo, so it has a tighter limit than the plain writes.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { symbol: string; broker?: string; quantity: string }
      const symbol = body.symbol.trim().toUpperCase()
      if (!SYMBOL.test(symbol)) return reply.status(400).send({ error: 'This is not a valid ticker. Use the Yahoo Finance one, for example JEQP.DE' })
      const quantity = parseQuantity(body.quantity)
      if (!quantity) return reply.status(400).send({ error: QUANTITY_ERROR })

      let quote
      try {
        quote = await quotes.getQuote(symbol)
      } catch (err) {
        if (err instanceof UnknownSymbolError) {
          return reply.status(400).send({ error: `No listing found for ${symbol}. Use the Yahoo Finance ticker with its exchange suffix, for example JEQP.DE` })
        }
        if (err instanceof ProviderError) {
          request.log.warn({ err: reasonOf(err) }, 'quote lookup failed while adding a holding')
          return reply.status(502).send({ error: `Could not read a price for ${symbol}: ${reasonOf(err)}` })
        }
        throw err
      }
      // Only EUR and USD can be valued. A pence quote (GBp, London) or any other currency would need its own rate.
      if (!SUPPORTED.includes(quote.currency)) {
        return reply.status(400).send({ error: `${symbol} is quoted in ${quote.currency}, and only EUR and USD are supported. Look for a listing of the same fund in EUR, for example on Xetra (.DE)` })
      }

      const created = await createHolding({ symbol, name: quote.name, broker: body.broker?.trim() ?? '', currency: quote.currency as StockCurrency, quantity })
      if (!created) return reply.status(409).send({ error: 'This listing is already tracked at this broker. Edit its quantity instead.' })
      return reply.status(201).send(created)
    }
  )

  fastify.patch(
    '/holdings/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { broker: { type: 'string', maxLength: MAX_TEXT_LENGTH }, quantity: quantitySchema, active: { type: 'boolean' } },
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = request.body as { broker?: string; quantity?: string; active?: boolean }
      const quantity = body.quantity === undefined ? undefined : parseQuantity(body.quantity)
      if (body.quantity !== undefined && !quantity) return reply.status(400).send({ error: QUANTITY_ERROR })

      if (!(await getHolding(id))) return reply.status(404).send({ error: 'Holding not found' })
      const updated = await updateHolding(id, { broker: body.broker?.trim(), quantity: quantity ?? undefined, active: body.active })
      if (updated === 'duplicate') return reply.status(409).send({ error: 'This listing is already tracked at that broker' })
      if (!updated) return reply.status(404).send({ error: 'Holding not found' })
      return updated
    }
  )

  fastify.delete('/holdings/:id', { schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await deleteHolding(id))) return reply.status(404).send({ error: 'Holding not found' })
    return reply.status(204).send()
  })
}
