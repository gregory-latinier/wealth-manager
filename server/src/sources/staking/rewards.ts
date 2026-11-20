import { keccakHex } from '../../lib/keccak'
import type { EthCall } from '../smardex/ownership'

// Everything staking contract (an ERC1967 proxy, implementation "Staking"): the reward token and what a wallet can claim now.
const GET_EV_TOKEN = keccakHex('getEvToken()').slice(0, 10)
const GET_CLAIMABLE = keccakHex('getClaimableRewards(address)').slice(0, 10)

const WORD = /^0x[0-9a-f]{64}$/i

export const encodeGetEvToken = () => GET_EV_TOKEN
export const encodeGetClaimable = (wallet: string) => GET_CLAIMABLE + wallet.toLowerCase().replace(/^0x/, '').padStart(64, '0')

export type Claimable = { ok: true; token: string; raw: bigint } | { ok: false; error: string }

/** The reward token of a staking contract and the amount a wallet can claim, in the token's smallest unit. */
export async function readClaimable(ethCall: EthCall, contract: string, wallet: string): Promise<Claimable> {
  let outcomes
  try {
    outcomes = await ethCall([
      { to: contract, data: encodeGetEvToken() },
      { to: contract, data: encodeGetClaimable(wallet) },
    ])
  } catch (err) {
    return { ok: false, error: `rewards read failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}` }
  }
  const [token, claimable] = outcomes
  if (!token.ok) return { ok: false, error: `getEvToken(): ${token.error}` }
  if (!claimable.ok) return { ok: false, error: `getClaimableRewards(): ${claimable.error}` }
  // A contract that is not a staking contract answers with something other than one 32-byte word, or reverts.
  if (!WORD.test(token.result) || !WORD.test(claimable.result)) return { ok: false, error: 'not a staking contract: unexpected answer' }
  return { ok: true, token: '0x' + token.result.slice(-40).toLowerCase(), raw: BigInt(claimable.result) }
}
