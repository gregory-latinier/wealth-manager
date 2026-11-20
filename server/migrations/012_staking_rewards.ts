import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Optional: the staking contract and the wallet whose claimable rewards are read at each snapshot (EV on Everything).
// Both or neither, so a position is never half configured.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns('StakingPosition', {
    rewardsContract: { type: 'text' },
    rewardsWallet: { type: 'text' },
  })
  pgm.addConstraint('StakingPosition', 'StakingPosition_rewards_both_or_neither', {
    check: '("rewardsContract" IS NULL) = ("rewardsWallet" IS NULL)',
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint('StakingPosition', 'StakingPosition_rewards_both_or_neither')
  pgm.dropColumns('StakingPosition', ['rewardsContract', 'rewardsWallet'])
}
