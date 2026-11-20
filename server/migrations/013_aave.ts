import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Wallets the Aave source reads. No foreign key to SnapshotLine: removing a wallet must never change history.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('AaveWallet', {
    id: { type: 'text', primaryKey: true },
    label: { type: 'text', notNull: true },
    // Lowercase 0x address. One row per wallet.
    address: { type: 'text', notNull: true, unique: true },
    active: { type: 'boolean', notNull: true, default: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('AaveWallet')
}
