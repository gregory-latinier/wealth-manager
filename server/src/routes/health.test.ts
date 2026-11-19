import { buildApp } from '../index'
import { pool } from '../db/index'

describe('GET /api/health', () => {
  afterAll(async () => {
    await pool.end()
  })

  it('reports ok when the database answers', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', db: 'up' })
    await app.close()
  })
})
