import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// `credentials` is AES-256-GCM ciphertext (see lib/secrets.ts), never plaintext. No foreign key to SnapshotLine:
// deleting or pausing an account must not change history.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('ExchangeAccount', {
    id: { type: 'text', primaryKey: true },
    exchange: { type: 'text', notNull: true, check: "exchange IN ('kraken', 'okx')" },
    label: { type: 'text', notNull: true },
    credentials: { type: 'text', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  // The label is the account's name in the app and part of its snapshot refs, so it is unique per exchange.
  pgm.addConstraint('ExchangeAccount', 'ExchangeAccount_exchange_label_unique', { unique: ['exchange', 'label'] })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('ExchangeAccount')
}
