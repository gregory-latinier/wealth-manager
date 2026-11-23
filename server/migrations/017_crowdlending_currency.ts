import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// A loan can be in EUR or USD. Every existing loan was in EUR, so that is the default. The currency never changes after the loan.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('CrowdlendingLoan', { currency: { type: 'text', notNull: true, default: 'EUR' } })
  pgm.addConstraint('CrowdlendingLoan', 'CrowdlendingLoan_currency_check', { check: `"currency" IN ('EUR', 'USD')` })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('CrowdlendingLoan', 'CrowdlendingLoan_currency_check')
  pgm.dropColumn('CrowdlendingLoan', 'currency')
}
