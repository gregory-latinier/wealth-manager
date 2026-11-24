import fs from 'fs'
import os from 'os'
import path from 'path'
import { pool, query } from './index'
import { findMigrationsDir, migrationNames, pendingMigrations } from './pending-migrations'

describe('pending migrations', () => {
  afterAll(async () => {
    await pool.end()
  })

  it('lists migration files by name, ignoring declarations and other files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
    for (const f of ['002_b.js', '001_a.ts', '001_a.d.ts', '002_b.js.map', 'README.md']) fs.writeFileSync(path.join(dir, f), '')
    expect(migrationNames(dir)).toEqual(['001_a', '002_b'])
  })

  it('finds the migrations directory of the repository', () => {
    expect(findMigrationsDir()).toMatch(/migrations$/)
  })

  it('has nothing pending on the test database, which runs every migration before the tests', async () => {
    expect(await pendingMigrations()).toEqual([])
  })

  it('reports a migration file that was never run', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
    const done = (await query<{ name: string }>('SELECT "name" FROM "pgmigrations" ORDER BY "name" LIMIT 1')).rows[0].name
    for (const n of [done, '999_not_run_yet']) fs.writeFileSync(path.join(dir, `${n}.ts`), '')
    expect(await pendingMigrations(dir)).toEqual(['999_not_run_yet'])
  })

  it('says nothing, rather than guess, when there is no directory', async () => {
    expect(await pendingMigrations(null as unknown as string)).toBeNull()
  })
})
