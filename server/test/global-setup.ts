import { Client } from 'pg'
import path from 'path'
import { spawnSync } from 'child_process'

const TEST_DB = 'wealthmanager_test'

// Tests truncate tables, so they run against their own database and never touch dev data.
export default async function globalSetup() {
  const base = process.env.DATABASE_URL || 'postgresql://wmuser:wmpassword@localhost:5433/wealthmanager'
  const admin = new URL(base)
  admin.pathname = '/postgres'

  const client = new Client({ connectionString: admin.toString() })
  await client.connect()
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB])
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE ${TEST_DB}`)
  } finally {
    await client.end()
  }

  const testUrl = new URL(base)
  testUrl.pathname = `/${TEST_DB}`

  const bin = path.join(__dirname, '..', 'node_modules', 'node-pg-migrate', 'bin', 'node-pg-migrate.js')
  const res = spawnSync(process.execPath, [bin, 'up', '-m', 'migrations'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    encoding: 'utf8',
  })
  if (res.status !== 0) {
    throw new Error(`Test database migration failed:\n${res.stdout}\n${res.stderr}`)
  }
}
