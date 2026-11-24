import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Adds Arbitrum ('arb') and Solana ('sol') to the chains CryptoAddress accepts, and Arbitrum to the ones whose tokens can be ignored.
// Solana has no ignorable tokens yet: only its native SOL is tracked.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('CryptoAddress', 'CryptoAddress_chain_check')
  pgm.addConstraint('CryptoAddress', 'CryptoAddress_chain_check', { check: "chain IN ('btc', 'eth', 'base', 'bsc', 'arb', 'sol')" })
  pgm.dropConstraint('IgnoredToken', 'IgnoredToken_chain_check')
  pgm.addConstraint('IgnoredToken', 'IgnoredToken_chain_check', { check: "chain IN ('eth', 'base', 'bsc', 'arb')" })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Rows on the new chains would violate the old constraints, so remove them first.
  pgm.sql(`DELETE FROM "CryptoAddress" WHERE "chain" IN ('arb', 'sol')`)
  pgm.sql(`DELETE FROM "IgnoredToken" WHERE "chain" = 'arb'`)
  pgm.dropConstraint('IgnoredToken', 'IgnoredToken_chain_check')
  pgm.addConstraint('IgnoredToken', 'IgnoredToken_chain_check', { check: "chain IN ('eth', 'base', 'bsc')" })
  pgm.dropConstraint('CryptoAddress', 'CryptoAddress_chain_check')
  pgm.addConstraint('CryptoAddress', 'CryptoAddress_chain_check', { check: "chain IN ('btc', 'eth', 'base', 'bsc')" })
}
