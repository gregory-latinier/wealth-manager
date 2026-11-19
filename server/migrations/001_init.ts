import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Baseline migration: later migrations add the real tables.
// Kept as a no-op so `migrate:up` and `migrate:prod` can be verified on a fresh database.
export async function up(_pgm: MigrationBuilder): Promise<void> {}

export async function down(_pgm: MigrationBuilder): Promise<void> {}
