import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Wallets the Smardex source reads. Separate from CryptoAddress so a wallet can be tracked for Smardex only.
// No foreign key to the cache tables or to SnapshotLine: removing a wallet must never change history.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('SmardexWallet', {
    id: { type: 'text', primaryKey: true },
    label: { type: 'text', notNull: true },
    // Lowercase 0x address. One row per wallet.
    address: { type: 'text', notNull: true, unique: true },
    active: { type: 'boolean', notNull: true, default: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  // Until now the source read the active Ethereum addresses of the Crypto list. Every address it already scanned becomes
  // a wallet, so the positions in earlier snapshots keep being tracked after this change.
  pgm.sql(`
    INSERT INTO "SmardexWallet" ("id", "label", "address")
    SELECT 'sw_' || md5(p."address"), COALESCE(MIN(c."label"), 'Wallet'), p."address"
      FROM (SELECT DISTINCT "address" FROM "SmardexPosition") p
      LEFT JOIN "CryptoAddress" c ON c."address" = p."address" AND c."chain" = 'eth'
     GROUP BY p."address"
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('SmardexWallet')
}
