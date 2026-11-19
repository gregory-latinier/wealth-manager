import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// No foreign key to SnapshotLine in either direction: deleting or pausing an address must never
// change history (snapshot lines are denormalized on purpose).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('CryptoAddress', {
    id: { type: 'text', primaryKey: true },
    label: { type: 'text' },
    chain: { type: 'text', notNull: true, check: "chain IN ('btc', 'eth', 'base')" },
    address: { type: 'text', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.addConstraint('CryptoAddress', 'CryptoAddress_chain_address_unique', { unique: ['chain', 'address'] })

  // One native row per address, plus the ERC-20 tokens the owner chose to track.
  pgm.createTable('CryptoAsset', {
    id: { type: 'text', primaryKey: true },
    addressId: { type: 'text', notNull: true, references: '"CryptoAddress"', onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true, check: "kind IN ('native', 'token')" },
    symbol: { type: 'text', notNull: true },
    contractAddress: { type: 'text' },
    decimals: { type: 'integer', notNull: true, check: 'decimals BETWEEN 0 AND 36' },
    active: { type: 'boolean', notNull: true, default: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.addConstraint('CryptoAsset', 'CryptoAsset_kind_contract_check', {
    check: "(kind = 'native' AND \"contractAddress\" IS NULL) OR (kind = 'token' AND \"contractAddress\" IS NOT NULL)",
  })
  // A plain unique constraint would allow several native rows (NULLs are distinct), so coalesce.
  pgm.sql(
    `CREATE UNIQUE INDEX "CryptoAsset_address_contract_unique" ON "CryptoAsset" ("addressId", COALESCE("contractAddress", ''))`
  )
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('CryptoAsset')
  pgm.dropTable('CryptoAddress')
}
