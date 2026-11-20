import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// What the opening event says about a position: when it was opened and at what price. The chain does not keep this in
// storage, so it is cached with the id. Both are null for rows cached before this migration, and are filled in by the
// next full read of the address's history.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns('SmardexPosition', {
    openedAt: { type: 'timestamptz' },
    // 18-decimal integer of the USD price of one wstETH, as text like the other uint values.
    entryPrice: { type: 'text' },
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumns('SmardexPosition', ['openedAt', 'entryPrice'])
}
