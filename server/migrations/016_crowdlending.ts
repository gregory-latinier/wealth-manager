import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Crowdlending loans typed in by the owner, one row per project. No foreign key to SnapshotLine: removing a loan must never change history.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('CrowdlendingLoan', {
    id: { type: 'text', primaryKey: true },
    // The platform, for example 8lends or La Premiere Brique.
    platform: { type: 'text', notNull: true },
    // The project that was financed.
    name: { type: 'text', notNull: true },
    // What was lent, in EUR. Never changes after the loan.
    lent: { type: 'numeric(20,2)', notNull: true },
    // What is still to be refunded, in EUR. This is what counts in the net worth. 0 once the loan is repaid.
    outstanding: { type: 'numeric(20,2)', notNull: true },
    // Expected date of the refund, the day to check it. A date, not a timestamp: no timezone.
    dueDate: { type: 'date', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    createdAt: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })
  pgm.addConstraint('CrowdlendingLoan', 'CrowdlendingLoan_amounts_check', { check: `"lent" > 0 AND "outstanding" >= 0` })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('CrowdlendingLoan')
}
