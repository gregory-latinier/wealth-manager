# Provider findings (T3 spike)

Probed live on 2026-11-19 with public addresses only (BTC genesis address, a well-known public EVM wallet), never the owner's. Recorded responses are in `server/src/sources/crypto/__fixtures__/`, with EVM token addresses replaced by made-up ones.

All endpoints below were called **without any API key**. "Verified" means I saw the response; anything else is marked as unverified.

## Summary and decisions this changes

| Need | Provider | Verdict |
|---|---|---|
| BTC balance | mempool.space | OK, keyless, verified |
| ETH and Base **balances** (native and ERC-20) | Public JSON-RPC | OK, keyless, verified. **Replaces Blockscout for the daily snapshot.** |
| ETH token **scan** (discover what an address holds) | Blockscout `eth.blockscout.com` | OK keyless, verified, but slow and noisy (see below) |
| Base token **scan** | none keyless | **Gap.** Blockscout and Etherscan need a key or block bots on Base |
| Crypto prices | CoinGecko | OK keyless, verified, including by contract on `ethereum` and `base` |
| USD/EUR rate | Frankfurter | OK keyless, verified |

### Spec assumptions that turned out wrong

1. **"Blockscout serves ETH and Base keyless" is only half true.**
   - `eth.blockscout.com` works keyless.
   - `base.blockscout.com` answers every non-browser request with a Cloudflare challenge (HTTP 403, "Just a moment..."), even with an honest `User-Agent`. I did not try to get around it.
   - `api.blockscout.com` (the unified multi-chain host) returns HTTP 402 "Proceed with API key or make a X402 payment" without a key.
   - Etherscan v2 answers "Free API access is not supported for this chain" for Base.
2. **Blockscout's `reputation` spam flag is nearly useless.** In a wallet with 8,206 token entries, all 8,206 had `reputation: "ok"`, while 7,851 had no price. The value threshold and the "unpriced" group do the real filtering. The spec's "spam-flagged tokens are hidden" criterion stays, but it's a secondary filter.
3. **Token balance responses mix standards.** The list had ERC-20 (6,931), ERC-721 (701), ERC-1155 (567), ERC-404 (5) and others. The scan must keep only `type === "ERC-20"` (NFTs are out of scope).

## Proposed architecture (needs owner decision, see bottom)

Split reading from discovering:

- **Snapshot (daily, must be reliable): JSON-RPC.** The tracked tokens are already known, so no discovery is needed. Per address, one `eth_getBalance` plus one `eth_call` `balanceOf` per tracked token, sent as a single JSON-RPC batch. Keyless and fast on both chains, and it doesn't depend on any indexer.
- **Token scan (occasional, interactive): Blockscout on Ethereum.** Used only when the owner adds an address. It is slow (see below), which is acceptable for a one-off click.
- **Base token scan:** has no keyless source today. Options are in the decision list below.
- **Manual add by contract:** works on both chains over RPC. `decimals()` (`0x313ce567`) and `symbol()` (`0x95d89b41`) are verified. Symbols can come back as `bytes32` on some old tokens, so the decoder must handle both a string and bytes32.

## Per-provider details

### BTC: mempool.space (verified)

- `GET https://mempool.space/api/address/{address}`
- Response: `chain_stats` and `mempool_stats`, each with `funded_txo_sum` and `spent_txo_sum`. **Units are satoshis** (confirmed on the probe).
- Balance in sats = `chain_stats.funded_txo_sum - chain_stats.spent_txo_sum` (confirmed only). Ignore `mempool_stats` so a snapshot never counts an unconfirmed transaction.
- Rate limits: documented as existing, with no numeric thresholds. A 429 is returned when exceeded, and repeated abuse may lead to a ban. One request per BTC address per day is far below any plausible limit.
- Not verified: legacy, P2SH, bech32 and taproot are all accepted by the address endpoint. I only probed a legacy address. T9/T10 tests should cover the other formats against the live API once.

### EVM balances: public JSON-RPC (verified)

| Chain | Endpoint (probed, HTTP 200) |
|---|---|
| Ethereum | `https://ethereum-rpc.publicnode.com` |
| Base | `https://mainnet.base.org`, and `https://base-rpc.publicnode.com` as a second source |

- `eth_getBalance` returns wei as hex. `eth_call` with `0x70a08231` plus the padded address returns an ERC-20 `balanceOf` as a 32-byte hex.
- JSON-RPC **batching works** on `mainnet.base.org` (array of requests, array of responses).
- `cloudflare-eth.com` refused ("Cannot fulfill request"), so it is not usable.
- `mainnet.base.org` rejects indexer-style methods such as `alchemy_getTokenBalances` (HTTP 401), as expected. Plain RPC can't list an address's tokens.
- Free public RPCs have no SLA. Mitigation: make the RPC URL per chain configurable by env var, and try the fallback URL on failure before the engine falls back to carry-forward.
- Not verified: the rate limits of these public RPCs. Batching keeps a daily run to a handful of requests per address.

### Token scan: Blockscout on Ethereum (verified), Base (blocked)

- `GET https://eth.blockscout.com/api/v2/addresses/{address}/token-balances` returns a JSON array. Each item has `token` (`address_hash`, `symbol`, `name`, `decimals` as a string, `type`, `exchange_rate` as a USD price string or `null`, `reputation`) and `value` (raw units as a string).
- **Slow on big wallets:** the probe wallet returned 8,206 entries in about 23 seconds. The scan needs a generous timeout (60 s), a spinner in the UI, and must filter to `type === "ERC-20"` and `exchange_rate != null` before doing anything else.
- `GET /api/v2/addresses/{address}` returns `coin_balance` (wei as a string) and `exchange_rate` (USD price of ETH).
- Blockscout's own documentation says free API keys get 5 requests per second and 100K credits per day. Keyless limits are not documented, and I did not test them.

### Prices: CoinGecko (verified keyless)

- Native: `GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd` returned `{"bitcoin":{"usd":63953},"ethereum":{"usd":1812.27}}`.
- By contract: `GET /api/v3/simple/token_price/{platform}?contract_addresses=a,b&vs_currencies=usd`, with platform ids **`ethereum`** and **`base`** (confirmed through `/asset_platforms`, chain ids 1 and 8453). The probe returned USDC prices on both. Addresses must be lowercase. The docs say up to 515 contract addresses per request.
- Gotcha: a token CoinGecko doesn't know is **omitted from the response**, not returned as null. The adapter must treat "missing key" as "unpriced".
- Rate limits: not documented on the pages I could read, and the response carried no rate-limit headers. Not verified. One request per day per chain is far below any known limit. The optional `COINGECKO_API_KEY` stays in the plan.
- The price is the global average across exchanges, and **EUR is derived from USD** with the Frankfurter rate, so every line uses the same rate.

### FX: Frankfurter (verified keyless)

- `GET https://api.frankfurter.dev/v2/rate/USD/EUR` returned `{"date":"2026-11-19","base":"USD","quote":"EUR","rate":0.91052}`.
- No key. The docs say rates are reference rates (not live quotes) and update through the day. They also say requests are rate-limited, with no numbers given.
- The response includes `date`. The adapter should store it, so a stale rate (a weekend or holiday rate reused) is visible.

## Decisions (owner answered 2026-11-19)

1. **Option A:** a free Blockscout key for the Base scan only (`BLOCKSCOUT_API_KEY`). The scan is disabled with a clear message if the key is unset.
2. **RPC for daily balances:** approved.
3. **Default public RPC URLs, overridable by env var:** approved.

The options as they were presented:

1. **Base token scan has no keyless source.** Options:
   - **A (recommended): free API key.** Get a free Blockscout key (5 req/s, 100K credits/day) for `api.blockscout.com`, kept in an env var and used only for the Base scan. The spec already allows adding a free key later. The scan stays automatic on both chains.
   - **B: manual only on Base.** No automatic scan on Base. You add Base tokens by contract address, which already works over RPC. Nothing new to sign up for, but it breaks the "scan and pick" promise for Base.
   - **C: skip.** Ship Ethereum scan now and decide on Base later.
2. **Use RPC for daily balances instead of Blockscout** (recommended, as described above). It changes T10's adapter list: `blockscout.ts` becomes a scan-only adapter, and a new `evm-rpc.ts` handles balances. This also removes the Cloudflare risk from the daily cron.
3. **Public RPC URLs** (`ethereum-rpc.publicnode.com`, `mainnet.base.org`) are used by default and configurable by env var. OK?

## Impact on the plan

- T10 splits: `btc.ts`, `evm-rpc.ts` (balances, metadata), `coingecko.ts`, and `blockscout.ts` (scan only).
- T12 (scan): filters `ERC-20` only, needs a long timeout and a "scanning..." state, and on Base uses the option chosen above.
- T3 verification step "owner reads this file" is the Checkpoint A gate.
