import { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth'
import { SECTIONS, getHiddenSections, setHiddenSections, type Section } from '../lib/settings'

export const adminSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  // Every admin route needs a session.
  fastify.addHook('preHandler', requireAuth)

  fastify.get('/', async () => ({ sections: SECTIONS, hiddenSections: await getHiddenSections() }))

  fastify.patch(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            hiddenSections: { type: 'array', maxItems: SECTIONS.length, uniqueItems: true, items: { type: 'string', enum: [...SECTIONS] } },
          },
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => {
      const body = request.body as { hiddenSections?: Section[] }
      if (body.hiddenSections) await setHiddenSections(body.hiddenSections)
      return { sections: SECTIONS, hiddenSections: await getHiddenSections() }
    }
  )
}
