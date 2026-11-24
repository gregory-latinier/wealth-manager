import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// GoMining miners typed in by the owner. GoMining has no public API and the miners live in the owner's account, so nothing can be read.
// The value per TH and the wallet balances are in the Setting table. No foreign key to SnapshotLine: removing a miner never changes history.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('GominingMiner', {
    id: { type: 'text', primaryKey: true },
    name: { type: 'text', notNull: true },
    // Computing power in TH/s. Upgrades raise it, so it is editable.
    th: { type: 'numeric(18,4)', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.addConstraint('GominingMiner', 'GominingMiner_th_check', { check: `"th" > 0` })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('GominingMiner')
}
