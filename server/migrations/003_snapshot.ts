import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Lines are denormalized on purpose: history must not change when an address is renamed or deleted.
// Scales match lib/money.ts: amounts and prices 18 dp, USD/EUR values and the rate 8 dp.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('Snapshot', {
    id: { type: 'text', primaryKey: true },
    date: { type: 'date', notNull: true, unique: true },
    usdPerEur: { type: 'numeric(20,8)', notNull: true },
    rateDate: { type: 'date' },
    rateStale: { type: 'boolean', notNull: true, default: false },
    totalUsd: { type: 'numeric(28,8)', notNull: true },
    totalEur: { type: 'numeric(28,8)', notNull: true },
    status: { type: 'text', notNull: true, check: "status IN ('complete', 'partial')" },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })

  pgm.createTable('SnapshotLine', {
    id: { type: 'text', primaryKey: true },
    snapshotId: { type: 'text', notNull: true, references: '"Snapshot"', onDelete: 'CASCADE' },
    sourceType: { type: 'text', notNull: true },
    sourceRef: { type: 'text', notNull: true },
    symbol: { type: 'text', notNull: true },
    amount: { type: 'numeric(38,18)', notNull: true },
    priceUsd: { type: 'numeric(38,18)', notNull: true },
    valueUsd: { type: 'numeric(28,8)', notNull: true },
    valueEur: { type: 'numeric(28,8)', notNull: true },
    stale: { type: 'boolean', notNull: true, default: false },
    staleSince: { type: 'date' },
  })
  pgm.addConstraint('SnapshotLine', 'SnapshotLine_snapshot_source_unique', {
    unique: ['snapshotId', 'sourceType', 'sourceRef'],
  })
  // Carry-forward looks up the latest line of one (sourceType, sourceRef) across snapshots.
  pgm.createIndex('SnapshotLine', ['sourceType', 'sourceRef'])
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('SnapshotLine')
  pgm.dropTable('Snapshot')
}
