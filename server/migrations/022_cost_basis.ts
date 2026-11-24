import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// What the owner paid for a position, typed in by hand, so the dashboard can show the unrealised gain or loss.
// Keyed like a snapshot line (source type + reference) and with no foreign key to it: a position that is sold or
// removed must never change history, and a cost can be entered before the next snapshot sees the line.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('CostBasis', {
    sourceType: { type: 'text', notNull: true },
    sourceRef: { type: 'text', notNull: true },
    // The total paid for the whole position, in USD, not a price per unit. Zero is allowed (an airdrop).
    costUsd: { type: 'numeric(28,8)', notNull: true },
    updatedAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.addConstraint('CostBasis', 'CostBasis_pkey', { primaryKey: ['sourceType', 'sourceRef'] })
  pgm.addConstraint('CostBasis', 'CostBasis_costUsd_check', { check: '"costUsd" >= 0' })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('CostBasis')
}
