import fs from 'fs'
import path from 'path'
import { query } from './index'

/** Migration files sit in `server/migrations` when run from source and in `dist/migrations` once built. */
export function findMigrationsDir(from = __dirname): string | null {
  return [path.join(from, '../migrations'), path.join(from, 'migrations'), path.join(from, '../../migrations')].find((d) => fs.existsSync(d)) ?? null
}

/** Names of the migration files in a directory, without extension. Declaration and map files are not migrations. */
export function migrationNames(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.(ts|js)$/.test(f) && !f.endsWith('.d.ts'))
    .map((f) => f.replace(/\.(ts|js)$/, ''))
    .sort()
}

/** Migrations that exist as files but are not recorded as run. Null when the directory or the table cannot be read. */
export async function pendingMigrations(dir = findMigrationsDir()): Promise<string[] | null> {
  if (!dir) return null
  try {
    const done = new Set((await query<{ name: string }>('SELECT "name" FROM "pgmigrations"')).rows.map((r) => r.name))
    return migrationNames(dir).filter((n) => !done.has(n))
  } catch {
    return null
  }
}
