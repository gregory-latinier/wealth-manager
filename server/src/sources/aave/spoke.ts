import { keccakHex } from '../../lib/keccak'
import { Decimal, fromBaseUnits } from '../../lib/money'
import type { EvmProvider } from '../crypto/providers/types'
import { reasonOf, type EthCall } from '../smardex/ownership'

// Aave v4 is Hub and Spoke: a wallet's position lives in a Spoke, per reserve, and is not an ERC-20 token in the wallet.
// This is the Spoke behind pro.aave.com on Ethereum mainnet (a TransparentUpgradeableProxy, implementation "SpokeInstance").
export const AAVE_SPOKE = '0x94e7a5dcbe816e498b89ab752661904e2f56c485'

const selector = (signature: string) => keccakHex(signature).slice(0, 10)
const SELECTORS = {
  getReserveCount: selector('getReserveCount()'),
  getReserve: selector('getReserve(uint256)'),
  getUserSuppliedAssets: selector('getUserSuppliedAssets(uint256,address)'),
  getUserTotalDebt: selector('getUserTotalDebt(uint256,address)'),
  getUserAccountData: selector('getUserAccountData(address)'),
}

const word = (value: bigint | string) => (typeof value === 'bigint' ? value.toString(16) : value.toLowerCase().replace(/^0x/, '')).padStart(64, '0')
const WORD = /^0x[0-9a-f]{64}$/i

/** The one 32-byte word of an answer. Anything else is not what this Spoke returns. */
function oneWord(outcome: { ok: true; result: string } | { ok: false; error: string }, what: string): bigint {
  if (!outcome.ok) throw new Error(`${what}: ${outcome.error}`)
  if (!WORD.test(outcome.result)) throw new Error(`${what}: unexpected answer`)
  return BigInt(outcome.result)
}

export interface ReservePosition {
  reserveId: number
  /** Lowercase contract of the asset the reserve holds. */
  underlying: string
  symbol: string
  /** What the wallet has supplied, interest included. */
  supplied: Decimal
  /** What the wallet owes, interest included. */
  debt: Decimal
}

export interface ReserveFailure {
  reserveId: number
  reason: string
}

export interface WalletReading {
  /** Only reserves where the wallet supplied or owes something. */
  positions: ReservePosition[]
  /** Reserves that could not be read. Their value is unknown, not 0. */
  failures: ReserveFailure[]
  /** Collateral value over debt value. Below 1 the position can be liquidated. Null when nothing is borrowed. */
  healthFactor: Decimal | null
}

/** Reads what a wallet supplied and owes on every reserve of the Spoke. Throws when the Spoke itself cannot be read. */
export async function readWallet(ethCall: EthCall, evm: Pick<EvmProvider, 'getTokenMetadata'>, wallet: string): Promise<WalletReading> {
  const [count] = await ethCall([{ to: AAVE_SPOKE, data: SELECTORS.getReserveCount }])
  const reserves = Number(oneWord(count, 'getReserveCount()'))
  if (!Number.isSafeInteger(reserves) || reserves > 1000) throw new Error('getReserveCount(): not a Spoke')

  const ids = Array.from({ length: reserves }, (_, i) => i)
  const outcomes = await ethCall([
    ...ids.flatMap((id) => [
      { to: AAVE_SPOKE, data: SELECTORS.getUserSuppliedAssets + word(BigInt(id)) + word(wallet) },
      { to: AAVE_SPOKE, data: SELECTORS.getUserTotalDebt + word(BigInt(id)) + word(wallet) },
    ]),
    { to: AAVE_SPOKE, data: SELECTORS.getUserAccountData + word(wallet) },
  ])

  const failures: ReserveFailure[] = []
  const raw: Array<{ reserveId: number; supplied: bigint; debt: bigint }> = []
  for (const id of ids) {
    try {
      const supplied = oneWord(outcomes[id * 2], `getUserSuppliedAssets(${id})`)
      const debt = oneWord(outcomes[id * 2 + 1], `getUserTotalDebt(${id})`)
      if (supplied > 0n || debt > 0n) raw.push({ reserveId: id, supplied, debt })
    } catch (err) {
      failures.push({ reserveId: id, reason: reasonOf(err) })
    }
  }

  // Asset and decimals are only needed for the reserves that hold something.
  const meta = raw.length > 0 ? await ethCall(raw.map((r) => ({ to: AAVE_SPOKE, data: SELECTORS.getReserve + word(BigInt(r.reserveId)) }))) : []
  const positions: ReservePosition[] = []
  for (const [i, r] of raw.entries()) {
    try {
      const reserve = meta[i]
      if (!reserve) throw new Error(`getReserve(${r.reserveId}): no result returned`)
      if (!reserve.ok) throw new Error(`getReserve(${r.reserveId}): ${reserve.error}`)
      const fields = reserve.result.slice(2).match(/.{64}/g) ?? []
      const [asset, , , decimalsWord] = fields
      if (!asset || !decimalsWord) throw new Error(`getReserve(${r.reserveId}): unexpected answer`)
      const underlying = '0x' + asset.slice(-40).toLowerCase()
      const decimals = Number(BigInt('0x' + decimalsWord))
      const { symbol } = await evm.getTokenMetadata('eth', underlying)
      positions.push({ reserveId: r.reserveId, underlying, symbol, supplied: fromBaseUnits(r.supplied, decimals), debt: fromBaseUnits(r.debt, decimals) })
    } catch (err) {
      failures.push({ reserveId: r.reserveId, reason: reasonOf(err) })
    }
  }

  return { positions, failures, healthFactor: readHealthFactor(outcomes[ids.length * 2]) }
}

// uint256 max is what the Spoke answers when there is no debt.
const NO_DEBT = (1n << 256n) - 1n

function readHealthFactor(outcome: { ok: true; result: string } | { ok: false; error: string } | undefined): Decimal | null {
  if (!outcome?.ok) return null
  // getUserAccountData returns seven words: riskPremium, avgCollateralFactor, healthFactor, ... The factor has 18 decimals.
  const fields = outcome.result.slice(2).match(/.{64}/g) ?? []
  if (fields.length < 7) return null
  const factor = BigInt('0x' + fields[2])
  return factor === NO_DEBT ? null : fromBaseUnits(factor, 18)
}
