import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Bank accounts typed in by the owner. No foreign key to SnapshotLine: removing an account must never change history.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('BankAccount', {
    id: { type: 'text', primaryKey: true },
    name: { type: 'text', notNull: true },
    // The institution, free text. Empty when not given.
    bank: { type: 'text', notNull: true, default: '' },
    currency: { type: 'text', notNull: true },
    // Cents. Negative for an overdraft.
    balance: { type: 'numeric(20,2)', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.addConstraint('BankAccount', 'BankAccount_currency_check', { check: `"currency" IN ('EUR', 'USD')` })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('BankAccount')
}
