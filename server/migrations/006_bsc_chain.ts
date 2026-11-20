import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Adds BNB Chain ('bsc') to the chains the two CHECK constraints accept.
// The constraint names are the ones Postgres generates for an inline column check.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('CryptoAddress', 'CryptoAddress_chain_check')
  pgm.addConstraint('CryptoAddress', 'CryptoAddress_chain_check', { check: "chain IN ('btc', 'eth', 'base', 'bsc')" })
  pgm.dropConstraint('IgnoredToken', 'IgnoredToken_chain_check')
  pgm.addConstraint('IgnoredToken', 'IgnoredToken_chain_check', { check: "chain IN ('eth', 'base', 'bsc')" })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Rows on 'bsc' would violate the old constraints, so remove them first.
  pgm.sql(`DELETE FROM "CryptoAddress" WHERE "chain" = 'bsc'`)
  pgm.sql(`DELETE FROM "IgnoredToken" WHERE "chain" = 'bsc'`)
  pgm.dropConstraint('IgnoredToken', 'IgnoredToken_chain_check')
  pgm.addConstraint('IgnoredToken', 'IgnoredToken_chain_check', { check: "chain IN ('eth', 'base')" })
  pgm.dropConstraint('CryptoAddress', 'CryptoAddress_chain_check')
  pgm.addConstraint('CryptoAddress', 'CryptoAddress_chain_check', { check: "chain IN ('btc', 'eth', 'base')" })
}
