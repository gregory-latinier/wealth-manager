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

### Base token scan with a Blockscout key (from the docs, NOT live-verified)

Looked up in the Blockscout docs while building T12. No key was available, so this shape has only been read, not called.

- `GET https://api.blockscout.com/8453/api/v2/addresses/{address}/tokens?type=ERC-20`, with the key as `Authorization: Bearer <key>` (an `apikey` query parameter also works).
- The response is paged: `{ items: [...], next_page_params: {...} | null }`. Each item has the same `token` and `value` fields as the keyless Ethereum list. The next page is requested by passing the `next_page_params` entries back as query parameters. The adapter follows at most 10 pages.
- The first real Base scan with a key should confirm this. Until then it is the least-tested path in the scan.

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


## Update: Base and BNB Chain token scan (Nov 2026)

The Blockscout key route for Base never worked: `api.blockscout.com` answered **HTTP 402** even with a key. A fake key got 401, the real one got 402, and neither the `Authorization: Bearer` header nor `apikey=` changed that. The keyed code was removed.

Keyless alternatives were checked and none lists an address's tokens on Base or BNB Chain:
- Routescan answers for Ethereum (1) and Avalanche (43114) but not Base (8453) or BNB Chain (56).
- Ankr multichain, Etherscan v2 and `base.blockscout.com` need a key or a plan, or sit behind a Cloudflare challenge.

So the scan on these two chains now asks the chain itself about a built-in list of popular tokens (`providers/known-tokens.ts`), in one batched RPC call, and prices only what is held through DefiLlama (`coins.llama.fi`, keyless, many contracts per request). It cannot discover a token that is not on the list: add those with the contract box. Decimals differ per chain (USDT and USDC are 18 on BNB Chain, 6 on Base), and were read from the contracts.

Token prices: CoinGecko's keyless tier now accepts **one contract per request** (HTTP 400, error 10012) and answers 429 after a few calls, so it cannot price a wallet. DefiLlama is asked first and CoinGecko is the fallback if DefiLlama fails (a token DefiLlama merely does not know stays unpriced, no fallback). Native prices (BTC, ETH, BNB) still come from CoinGecko. If both fail, the tokens are still listed and the dialog says prices are unavailable instead of showing them as worthless.

BNB Chain RPC: `bsc-dataseed1.binance.org` answered batches from the dev machine. `bsc-rpc.publicnode.com` and `bsc-dataseed.bnbchain.org` timed out there, and `rpc.ankr.com/bsc` needs a key. Set `BSC_RPC_URL` if your host reaches a different one.


## Update: exchange balances (Nov 2026)

Exchange accounts are a new source type (`exchange`) behind one interface, `ExchangeAdapter { verify, getBalances }`, in `server/src/sources/exchange/`. Adding an exchange means writing one adapter file and registering it in `createDefaultAdapters`. The table, routes, page and snapshot code do not change. `ExchangeAccount` already allows `okx`.

Kraken (`kraken.ts`): `POST /0/private/Balance`, signed with `API-Sign = base64(HMAC-SHA512(path + SHA256(nonce + body), base64decode(secret)))`. The signing code is tested against the example in Kraken's documentation. Kraken answers HTTP 200 with an `error` array, so that array is what decides success. The nonce must strictly increase, so it is a microsecond clock that never goes backwards.

Asset codes are normalised: legacy names (`XXBT` is BTC, `XETH`, `XXDG` is DOGE, `ZUSD`, `ZEUR`), the suffixes `.S .M .F .B .P` (staking and earn variants) and `ETH2`. Variants of one asset are merged into one line. USD counts at 1. Everything else is priced from public `AssetPairs` (online pairs quoted in USD) and `Ticker` (field `c[0]`). An asset with no online USD pair is reported unpriced and carried forward.

Keys: stored with AES-256-GCM, key derived with HKDF-SHA256 from `EXCHANGE_KEY_SECRET`, the account id bound as authenticated data so a ciphertext cannot be moved to another row. Format `v1.<iv>.<tag>.<ciphertext>`.

## Update: Smardex leveraged positions (Nov 2026)

Source type `smardex` (`server/src/sources/smardex/`). The wallets it reads are the `SmardexWallet` table, managed on the Smardex page (`/api/admin/smardex/wallets`). They are independent of the Crypto address list. The Smardex gateway (`usdn-gateway.api.smardex.io/.../positions?address=`) answers `403 Forbidden` from AWS API Gateway to any non-browser client, so it is not used. The positions are read from the contracts instead, which needs no key.

A position has no owner-indexed lookup on-chain: it is identified by `PositionId(int24 tick, uint256 tickVersion, uint256 index)`. So the work is split in two:

1. **Discovery** (`discovery.ts`). Blockscout v2 `GET /addresses/{address}/transactions?filter=from` (paginated by `next_page_params`) lists the address's transactions. Those sent to the protocol (`0x656cb8c6d154aad29d8771384089be5b5141f01a`), the UniversalRouter (`0x49f66b16...`) or LongFarming (`0xf9d36078...`) have their logs read with `GET /transactions/{hash}/logs`. `InitiatedOpenPosition` and `ValidatedOpenPosition` (owner is topic 1) and `PositionOwnershipTransferred` (new owner is topic 2) name the ids. Only logs emitted by the protocol contract count. The ids are cached in `SmardexPosition`, and `SmardexScan.lastTxHash` marks the newest transaction read, so later runs only read newer ones. Only ids are cached, never values.
2. **Valuation** (`index.ts`). Over the Ethereum RPC, `getLongPosition(id)` gives the owner as the protocol sees it (zero address: closed or liquidated). If that owner is LongFarming, `getPositionInfo(tick, tickVersion, index)` on LongFarming gives the real owner. For an open position, `getPositionValue(id, price, timestamp)` gives its value in wstETH wei (int256), with `price` the wstETH USD price in 18 decimals. The price comes from DefiLlama (`ethereum:0x7f39...`, as for any token).

Deleting a wallet clears its rows in `SmardexPosition` and `SmardexScan`, so re-adding it rescans from the start.

**Position details** (`details.ts`, `GET /api/admin/smardex/wallets/:id/positions`). The Smardex page shows, per open position, what the snapshot does not store. Read live, in one batched `eth_call`: `getLongPosition` (collateral `amount` and `totalExpo`, so leverage is `totalExpo / amount`), `getEffectivePriceForTick(tick)` on the protocol (the liquidation price: the position's tick already includes its liquidation penalty) and `getPositionValue`. From the opening event, cached in `SmardexPosition.openedAt` and `entryPrice` (migration 010): the date (`timestamp` of `InitiatedOpenPosition`) and the entry price (`startPrice`, replaced by `newStartPrice` from `ValidatedOpenPosition` when that event is found). PnL in wstETH is value minus collateral. PnL in USD is value at today's price minus collateral at the entry price, so it includes the move of wstETH itself. A position cached before migration 010 has no opening data: the first request re-reads the whole history of that wallet once (about 30 s for a busy one), then it is cached. A failed read leaves that field empty and flags the position; it is never shown as 0.

Caveats: "worth if closed now" is the protocol's own valuation and does not include the closing fee or gas. The entry price is the price recorded when the position was opened, not necessarily the one a front end displayed.

Selectors and event topics are computed at start from their signatures with the repo's own keccak-256 (`lib/keccak.ts`, tested against published vectors) rather than hard-coded.

Gotchas found live:
- **Blockscout v2 answers HTTP 500 for an all-lowercase address.** Requests must use the EIP-55 checksummed form (`toChecksumAddress`), while the app stores addresses lowercase.
- publicnode refuses `eth_getLogs` over any real range without a token, which is why discovery goes through Blockscout rather than reading events over RPC.
- Blockscout's legacy `?module=logs` endpoint times out for this wallet. Use the v2 API.

Failure behaviour: a failed scan does not hide earlier finds (the cache is still valued) and is reported as a failure on `<address>:scan`, which makes the snapshot partial instead of silently complete. A failed contract read or missing price fails that position, which the engine carries forward as stale. Nothing is ever valued at 0 because a call failed.

Not covered: pending LongFarming rewards (SDEX), other Smardex markets, and USDN or the liquidity-provider side. Only long positions on the WSTETH_USDN market are read.

## Update: staked tokens (Nov 2026)

Source type `staking` (`server/src/sources/staking/`). The positions are the `StakingPosition` table, managed on the Staking page (`/api/admin/staking/positions`). The first use is SDEX staked on everything.inc to earn EV. That site is a client-rendered app with no public API, so nothing can be read from it and the staked amount is typed in by the owner.

- **Symbol:** read from the ERC-20 contract over the Ethereum RPC when the stake is added, and stored. The contract cannot be changed afterwards, only the platform name and the amount.
- **Price:** `createPriceProvider(createCoinGecko())`, which is DefiLlama for tokens. SDEX (`0x5de8ab7e27f6e7a1fff3e5b337584aa43961beef`, 18 decimals) is priced by DefiLlama.
- **Refs:** `<position id>:<SYMBOL>`. The id never changes, so renaming the platform keeps the carry-forward history.
- **Failure behaviour:** one price lookup serves all stakes. If it fails, or a token has no price, those stakes are reported as failures and the engine carries their last value forward as stale. Nothing is valued at 0 because a lookup failed. A stake added for a token with no price is saved and the page warns about it.
- **Uniqueness:** one stake per platform and token. To change the quantity, edit the amount.

### Claimable rewards (EV on Everything)

A position can carry `rewardsContract` and `rewardsWallet` (migration 012, both set or both null). At each snapshot the source makes two `eth_call`s to the staking contract: `getEvToken()` for the reward token and `getClaimableRewards(address)` for what the wallet can claim now. The symbol and decimals of the reward token come from the token contract, and its price from DefiLlama in the same lookup as the staked token.

- **Contract:** Everything staking is the ERC1967 proxy `0x25b5D0216D28b3B348738326C514f7d1D4f8Ee2f` (implementation `Staking`, verified on Blockscout). It also exposes `getUserInfo(address)` (a flat struct `rewardDebt, stakedAmount, accReward, claimedReward`, so `stakedAmount` is the second word), `getPendingRewards(address)` and `getTotalStakedAmount()`. The EV token is `0xe7e7e741c23a4767831a56a8c99f522c5ac1e7e7` (18 decimals, DefiLlama prices it).
- **Which number counts:** `getClaimableRewards`, which is what a `claim()` pays now. `getPendingRewards` is larger (about 9.0M EV against 0.6M when this was written) and the contract does not say when the rest becomes claimable, so it is not counted.
- **Refs:** the rewards line is `<position id>:rewards`, with no symbol, so a failed token lookup still matches the previous line and carries it forward. The stake keeps `<id>:<SYMBOL>`.
- **Failure behaviour:** a revert, a bad answer, a missing reward token symbol or a missing price fails `<id>:rewards` only. The stake is still valued and the rewards keep their last value, marked stale. A claimable amount of exactly 0 is real and produces no line.
- **Validation:** when rewards are switched on, the contract must answer both calls with one 32-byte word, or the request is refused with 400 and nothing is saved.
- **Not covered:** the reward value is a snapshot of one moment. Claiming moves it into the wallet, where it is counted once the token is on the Crypto page.

## Update: Aave v4 (Nov 2026)

Source type `aave` (`server/src/sources/aave/`). The wallets are the `AaveWallet` table (migration 013), managed on the Aave page (`/api/admin/aave/wallets`). Aave v4 is Hub and Spoke: a position is bookkeeping inside a Spoke, per reserve, and is **not** an aToken in the wallet. v3 `getUserAccountData` on every v3 pool returns 0 for such a wallet, and the Crypto scan never sees it, so nothing is counted twice.

- **Spoke:** pro.aave.com on Ethereum is the Spoke `0x94e7A5dCbE816e498b89aB752661904E2F56c485` (TransparentUpgradeableProxy, implementation `SpokeInstance` `0xABd0E26FE17BDe4F1f1187Ed8aA80C274E03D8b5`, verified on Blockscout). Supplying native ETH goes through the `NativeTokenGateway` `0xe68ab4F90Fe026B9873F5F276eD2d7efBbbE42Be`, which supplies WETH on the wallet's behalf, so the wallet is the position owner. The reserves are numbered (0 is WETH, 7 is USDC at the time of writing) and `getReserve(id)` returns `(underlying, hub, assetId, decimals, ...)`.
- **Reads:** one batch of `eth_call`s per wallet: `getReserveCount()`, then for every reserve `getUserSuppliedAssets(reserveId, user)` and `getUserTotalDebt(reserveId, user)` (both in the underlying's smallest unit, interest included), `getReserve` for the reserves that hold something, and `getUserAccountData(user)` for the health factor (third word, 18 decimals; uint256 max means no debt). The symbol comes from the token contract and the price from DefiLlama.
- **Lines:** `<address>:<reserve id>:supply` with a positive amount and `<address>:<reserve id>:debt` with a **negative** amount. The engine stores amount times price, and totals sum the stored values, so a debt lowers the net worth with no change to the snapshot engine. A reserve with nothing supplied or owed has no line.
- **Failure behaviour:** if the Spoke cannot be read at all, every ref the wallet had in the latest snapshot is reported as a failure and carried forward as stale. This matters most for the debt: dropping it would raise the net worth by the amount owed. A reserve that cannot be read, or an asset with no price, fails only its own refs. Nothing is valued at 0 because a read failed.
- **Dashboard:** a negative group cannot be drawn in the donut, so it is left out and noted as borrowed, and the centre shows the net worth. In the breakdown, shares are of what is held, and a debt is a red bar.
- **Not covered:** other Spokes and other chains (the Spoke address is fixed in `spoke.ts`), Aave v3, rewards and Umbrella staking, and the borrow rate. The position moves every block, so the figure is one moment.

## Update: bank accounts (Nov 2026)

Source type `bank` (`server/src/sources/bank/`). The accounts are the `BankAccount` table (migration 014), managed on the Bank page (`/api/admin/bank/accounts`). Balances are entered by hand: there is no provider, so nothing to authenticate and nothing that can break at a bank. Open banking (GoCardless, Tink, Powens) was considered and left out for now.

- **Currencies:** EUR and USD, enforced by a check constraint. The currency cannot be edited, because it is part of the snapshot key.
- **Balance:** `numeric(20,2)`, a plain decimal with at most 2 decimals. Negative is an overdraft and is a negative line, so it lowers the net worth. Zero is allowed.
- **Lines:** `<account id>:EUR|USD`, symbol EUR or USD. A USD line has price 1. A EUR line has price `usdPerEur`, which the engine now passes to every source in `SnapshotContext.usdPerEur` (the rate it just fetched). Using the same rate as the totals means a EUR account is worth exactly its typed amount in EUR.
- **Failure behaviour:** `usdPerEur` is absent when the FX lookup failed, even though the engine falls back to the last stored rate for its own totals. A EUR account is then reported as a failure and carried forward as stale, never valued at 0. USD accounts do not need a rate and stay fresh.
- **Not covered:** other currencies, interest accrual, automatic balances, and account numbers (none are stored).

## Update: stocks and ETFs (Nov 2026)

Source type `stocks` (`server/src/sources/stocks/`). The holdings are the `StockHolding` table (migration 015), managed on the Stocks page (`/api/admin/stocks/holdings`). The owner types a quantity, the price comes from Yahoo Finance.

- **Provider:** `https://query1.finance.yahoo.com/v8/finance/chart/<ticker>?range=5d&interval=1d`, keyless. It is an unofficial endpoint and needs a browser-like `User-Agent`. Only `meta` is used: `regularMarketPrice`, `currency`, `regularMarketTime`, `longName`. An unknown ticker is HTTP 404 or `chart.error.code = "Not Found"`. Alternatives looked at: Stooq (CSV, no currency field), Alpha Vantage and Twelve Data (key and tight free quotas, thin on European ETFs). If Yahoo ever blocks the server the source reports failures and holdings go stale, they are never valued at 0.
- **One fund, several listings:** JEQP (JPM Nasdaq Equity Premium Income Active UCITS ETF USD Dist) answers on `JEQP.DE` (Xetra, EUR 21.77 on 2026-11-23) and `JEQP.L` (London, GBp 1823). `.MI` and `.AS` have no data. The ticker with its suffix is the identity, and the suffix fixes the currency.
- **Ticker search:** `GET /api/admin/stocks/search?q=` (2 to 60 characters, 20 per minute) calls `https://query1.finance.yahoo.com/v1/finance/search?q=<text>&quotesCount=10&newsCount=0&listsCount=0`, same keyless service and `User-Agent`. Only `ETF`, `EQUITY` and `MUTUALFUND` hits are kept, at most 8. The search result has no currency, so each hit is priced with the chart endpoint above, which gives its currency and price. Hits quoted in EUR or USD come first, the others are returned with `supported: false` and a reason (for example GBp for London) so the UI can grey them out. A hit whose price cannot be read is flagged, it does not fail the search. Searching by ISIN is unreliable on Yahoo, name and ticker work.
- **Currency:** read from the quote when the holding is added and stored. EUR and USD only. Anything else is refused with a hint, notably `GBp`/`GBX` (pence, a hundredth of a pound) which would otherwise be valued 100 times too high. At each snapshot a listing quoted in a different currency than stored is a failure, not a conversion.
- **Lines:** `<holding id>:<TICKER>`, symbol is the ticker, amount is the quantity. A USD listing has price = the USD price. A EUR listing has price = EUR price times `SnapshotContext.usdPerEur`, the rate the engine fetched for the same snapshot (see the bank section), so the stored EUR value is exactly quantity times the EUR price.
- **Failure behaviour:** a price that cannot be read, a last trade older than 14 days, or no EUR rate for a EUR listing fails only that holding, which is carried forward as stale. Quotes are fetched 3 at a time.
- **Not covered:** other currencies, dividends (the ETF is a distributing share class, the cash received is not tracked), cost basis and P&L, and prices outside trading hours. The figure is the last regular-market price.

## Update: crowdlending (Nov 2026)

Source type `crowdlending` (`server/src/sources/crowdlending/`). The loans are the `CrowdlendingLoan` table (migration 016), managed on the Crowdlending page (`/api/admin/crowdlending/loans`). There is no provider: 8lends and La Premiere Brique have no public API, so the owner types the figures, like bank accounts.

- **Per loan:** platform, project name, `lent` (fixed at creation), `outstanding` (what is still to be refunded) and `dueDate` (expected refund, a plain `date`).
- **Valuation:** only `outstanding` counts, in EUR. Lines are `<loan id>:EUR`, symbol EUR, amount = outstanding, price = the engine's fresh USD per EUR (same mechanism as the bank source). With no rate the loan fails and is carried forward as stale, never valued at 0.
- **Repayment:** the owner lowers `outstanding`. At 0 the line stays at 0, so the history shows the refund. `outstanding` cannot exceed `lent`.
- **Due dates:** the page marks a loan overdue when `dueDate` is before today and `outstanding > 0`, and "soon" within 30 days. A reminder by email or push is not built.
- **Not covered:** interest (counted as cash when paid), other currencies, automatic reading of the platforms, notifications.
