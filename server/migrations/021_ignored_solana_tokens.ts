import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Solana tokens can now be tracked, so they can be ignored too (a Solana wallet is full of airdropped junk).
// Migration 020 is already applied in places, so this is a new step and 020 is left alone.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('IgnoredToken', 'IgnoredToken_chain_check')
  pgm.addConstraint('IgnoredToken', 'IgnoredToken_chain_check', { check: "chain IN ('eth', 'base', 'bsc', 'arb', 'sol')" })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Rows on 'sol' would violate the old constraint, so remove them first.
  pgm.sql(`DELETE FROM "IgnoredToken" WHERE "chain" = 'sol'`)
  pgm.dropConstraint('IgnoredToken', 'IgnoredToken_chain_check')
  pgm.addConstraint('IgnoredToken', 'IgnoredToken_chain_check', { check: "chain IN ('eth', 'base', 'bsc', 'arb')" })
}
