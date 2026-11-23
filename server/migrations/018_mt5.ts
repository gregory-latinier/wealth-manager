import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// MT5 accounts the owner chose to count. The balances come from the accounts-monitoring feed, which does not say
// which currency an account is in, so the owner sets it here. No foreign key to SnapshotLine: removing an account never changes history.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('Mt5Account', {
    // The MT5 login number, as the feed writes it.
    login: { type: 'text', primaryKey: true },
    currency: { type: 'text', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.addConstraint('Mt5Account', 'Mt5Account_currency_check', { check: `"currency" IN ('EUR', 'USD')` })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('Mt5Account')
}
