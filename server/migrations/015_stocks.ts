import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Shares and ETFs held, typed in by the owner. No foreign key to SnapshotLine: removing a holding must never change history.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('StockHolding', {
    id: { type: 'text', primaryKey: true },
    // Yahoo Finance ticker of one listing, for example JEQP.DE. The suffix is the exchange, so it also fixes the currency.
    symbol: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    // Where it is held (broker or account). Empty when not given.
    broker: { type: 'text', notNull: true, default: '' },
    // Currency the listing is quoted in, read from the provider when the holding is added.
    currency: { type: 'text', notNull: true },
    quantity: { type: 'numeric(20,6)', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.addConstraint('StockHolding', 'StockHolding_currency_check', { check: `"currency" IN ('EUR', 'USD')` })
  pgm.addConstraint('StockHolding', 'StockHolding_symbol_broker_key', { unique: ['symbol', 'broker'] })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('StockHolding')
}
