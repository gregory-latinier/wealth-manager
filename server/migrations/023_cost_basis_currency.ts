import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// A cost can now be typed in EUR as well as USD. It is kept in the currency it was paid in, never converted when saved, so a euro
// cost stays exactly what was typed whatever the rate does later. Migration 022 is already applied in places and is left alone.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('CostBasis', 'CostBasis_costUsd_check')
  pgm.renameColumn('CostBasis', 'costUsd', 'cost')
  // Every cost entered so far was in USD.
  pgm.addColumn('CostBasis', { currency: { type: 'text', notNull: true, default: 'USD' } })
  pgm.alterColumn('CostBasis', 'currency', { default: null })
  pgm.addConstraint('CostBasis', 'CostBasis_cost_check', { check: '"cost" >= 0' })
  pgm.addConstraint('CostBasis', 'CostBasis_currency_check', { check: `"currency" IN ('USD', 'EUR')` })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // A euro cost cannot be turned into USD without a rate, so those rows are removed rather than silently misread as dollars.
  pgm.sql(`DELETE FROM "CostBasis" WHERE "currency" <> 'USD'`)
  pgm.dropConstraint('CostBasis', 'CostBasis_currency_check')
  pgm.dropConstraint('CostBasis', 'CostBasis_cost_check')
  pgm.dropColumn('CostBasis', 'currency')
  pgm.renameColumn('CostBasis', 'cost', 'costUsd')
  pgm.addConstraint('CostBasis', 'CostBasis_costUsd_check', { check: '"costUsd" >= 0' })
}
