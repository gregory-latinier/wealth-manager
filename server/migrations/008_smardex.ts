import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Positions are found by reading an address's transaction history, which is slow for a busy wallet. This caches what was
// found so each snapshot only reads the transactions made since. Only ids are stored, never values: those are read live.
// No foreign key to CryptoAddress: the cache is rebuilt from the chain, so it never blocks removing an address.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('SmardexScan', {
    address: { type: 'text', primaryKey: true },
    // Newest transaction already read. The next scan stops when it reaches it.
    lastTxHash: { type: 'text', notNull: true },
    updatedAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.createTable('SmardexPosition', {
    address: { type: 'text', notNull: true },
    tick: { type: 'integer', notNull: true },
    // uint256 values, kept as text so none can overflow a number type.
    tickVersion: { type: 'text', notNull: true },
    index: { type: 'text', notNull: true },
    foundAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.addConstraint('SmardexPosition', 'SmardexPosition_pkey', { primaryKey: ['address', 'tick', 'tickVersion', 'index'] })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('SmardexPosition')
  pgm.dropTable('SmardexScan')
}
