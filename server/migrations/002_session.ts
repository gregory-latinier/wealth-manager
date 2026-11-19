import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Only a SHA-256 hash of the session token is stored: a leaked database dump cannot be replayed as a login.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('Session', {
    id: { type: 'text', primaryKey: true },
    tokenHash: { type: 'text', notNull: true, unique: true },
    expiresAt: { type: 'timestamptz', notNull: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.createIndex('Session', 'expiresAt')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('Session')
}
