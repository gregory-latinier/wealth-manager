import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Tokens locked on a platform that has no API to read (for example SDEX staked on Everything). The owner types the
// amount in and it is priced like any Ethereum token. No foreign key to SnapshotLine: removing a position never changes history.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('StakingPosition', {
    id: { type: 'text', primaryKey: true },
    // Where the tokens are locked, as the owner names it.
    platform: { type: 'text', notNull: true },
    symbol: { type: 'text', notNull: true },
    // Lowercase ERC-20 contract on Ethereum, used to look the price up.
    contract: { type: 'text', notNull: true },
    amount: { type: 'numeric(38,18)', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.addConstraint('StakingPosition', 'StakingPosition_platform_contract_key', { unique: ['platform', 'contract'] })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('StakingPosition')
}
