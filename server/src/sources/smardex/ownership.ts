import type { CallOutcome } from '../crypto/providers/evm-rpc'
import { LONG_FARMING, PROTOCOL, decodeLongPosition, decodePositionInfoOwner, encodeGetLongPosition, encodeGetPositionInfo, isZeroAddress, type PositionId } from './abi'

export type EthCall = (calls: Array<{ to: string; data: string }>) => Promise<CallOutcome[]>

export const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300)

/** True when the position is open and the address's, directly or through LongFarming. False when closed, liquidated or someone else's. A string is why it could not be read. */
export async function ownedBy(ethCall: EthCall, address: string, p: PositionId): Promise<boolean | string> {
  const [position, info] = await ethCall([
    { to: PROTOCOL, data: encodeGetLongPosition(p) },
    { to: LONG_FARMING, data: encodeGetPositionInfo(p) },
  ])
  if (!position.ok) return position.error
  let user: string
  try {
    user = decodeLongPosition(position.result).user
  } catch (err) {
    return reasonOf(err)
  }
  if (isZeroAddress(user)) return false // closed or liquidated: the protocol clears the slot
  if (user === address) return true
  if (user !== LONG_FARMING) return false
  // Farmed: the protocol sees the farming contract, the farming contract knows the trader.
  if (!info.ok) return info.error
  try {
    return decodePositionInfoOwner(info.result) === address
  } catch (err) {
    return reasonOf(err)
  }
}
