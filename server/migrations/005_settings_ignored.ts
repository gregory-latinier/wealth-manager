import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Small key/value store for owner settings (currently the scan threshold in USD).
  pgm.createTable('Setting', {
    key: { type: 'text', primaryKey: true },
    value: { type: 'text', notNull: true },
  })

  // Tokens the owner never wants to see in a scan again. Not tied to an address on purpose:
  // a spam token is spam for every wallet.
  pgm.createTable('IgnoredToken', {
    id: { type: 'text', primaryKey: true },
    chain: { type: 'text', notNull: true, check: "chain IN ('eth', 'base')" },
    contractAddress: { type: 'text', notNull: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.addConstraint('IgnoredToken', 'IgnoredToken_chain_contract_unique', { unique: ['chain', 'contractAddress'] })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('IgnoredToken')
  pgm.dropTable('Setting')
}
