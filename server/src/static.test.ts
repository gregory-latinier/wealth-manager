import fs from 'fs'
import os from 'os'
import path from 'path'
import { FastifyInstance } from 'fastify'
import { buildApp } from './index'
import { pool } from './db/index'

describe('serving the built client', () => {
  let dir: string
  let app: FastifyInstance

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-client-'))
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>spa</title>')
    fs.mkdirSync(path.join(dir, 'assets'))
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)')
    app = await buildApp({ clientDist: dir })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('serves the SPA at / and falls back to index.html for client routes', async () => {
    for (const url of ['/', '/login', '/admin/crypto']) {
      const res = await app.inject({ method: 'GET', url })
      expect([url, res.statusCode]).toEqual([url, 200])
      expect(res.body).toContain('<title>spa</title>')
    }
  })

  it('serves static assets as themselves', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('console.log(1)')
  })

  it('keeps the API untouched: real routes work, unknown API paths are a JSON 404, not the SPA', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ status: 'ok' })
    const missing = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toEqual({ error: 'Not found' })
    expect((await app.inject({ method: 'GET', url: '/api/dashboard' })).statusCode).toBe(401)
  })

  it('does not hand the SPA to non-GET requests', async () => {
    expect((await app.inject({ method: 'POST', url: '/somewhere' })).statusCode).toBe(404)
  })

  it('does not serve files outside the client folder', async () => {
    const res = await app.inject({ method: 'GET', url: '/..%2f..%2fpackage.json' })
    expect(res.body).not.toContain('"name"')
  })

  it('serves only the API when no client build exists', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-empty-'))
    const bare = await buildApp({ clientDist: empty })
    await bare.ready()
    expect((await bare.inject({ method: 'GET', url: '/' })).statusCode).toBe(404)
    expect((await bare.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    await bare.close()
    fs.rmSync(empty, { recursive: true, force: true })
  })
})
