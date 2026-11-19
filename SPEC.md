# Spec: wealth-manager (personal net-worth tracker)

Status: APPROVED v2 (owner approved 2026-11-19).
Public repo name: `wealth-manager` (local folder is still `webapps/portfolio`).
Source of intent: [docs/intent/portfolio.md](docs/intent/portfolio.md) (confirmed 2026-11-19).
Reference stack: `C:\dev\projects\personal\meals-planner` (same hosting, same conventions).

## Assumptions I'm making

Correct any of these now or I'll proceed with them.

1. **One Fastify service serves the API and the built React client**, as a single Passenger app on o2switch. There is no Socket.IO and no PWA, since neither is needed.
2. **The login password is stored as a bcrypt hash in an env var** (`APP_PASSWORD_HASH`). There is no users table and no seed step. A `pnpm hash-password` script generates the hash. Sessions are random tokens in a `Session` table with an httpOnly cookie, like meals-planner.
3. **The snapshot endpoint is `POST /api/snapshots/run`**, guarded by `Authorization: Bearer <SNAPSHOT_TOKEN>`. The token is a separate env var and is compared in constant time. Your o2switch cron calls it with `curl`.
4. **The "day" is the UTC calendar date.** One snapshot per day. A second call on the same day replaces that day's snapshot (an upsert), so a double cron fire is harmless.
5. **v1 supports single addresses only.** BTC xpub/zpub wallets are not supported (decided).
6. **Data providers (verified live on 2026-11-19, details in [docs/providers.md](docs/providers.md)):**
   - BTC balances: mempool.space REST API (no key). Confirmed balance only, in satoshis.
   - ETH and Base **balances** (native and ERC-20): public JSON-RPC, batched (no key). Defaults are `https://ethereum-rpc.publicnode.com` and `https://mainnet.base.org`, each overridable by env var. This is what the daily snapshot uses, so it never depends on an indexer.
   - ETH and Base **token scan** (discovery only, when an address is added): Blockscout. Ethereum uses `eth.blockscout.com` keyless. Base needs a free Blockscout API key (`BLOCKSCOUT_API_KEY`, used only for the Base scan), because keyless Base access is blocked. Only `ERC-20` entries are kept, so NFTs are ignored.
   - Crypto prices in USD: CoinGecko free API (no key). Tokens are priced by contract address on the `ethereum` and `base` platforms. A token CoinGecko doesn't know is omitted from its response and is treated as unpriced. An optional demo key goes in an env var.
   - USD/EUR rate: Frankfurter (no key). The rate's `date` is stored so a stale rate is visible.
   - Providers sit behind small interfaces, so a fork can swap them.
7. **Monetary amounts are never JS floats.** Balances are stored as `NUMERIC` and handled as decimal strings, or with a decimal library in the server.
8. **License is MIT** (decided).
9. **The repo lives in `webapps/portfolio` locally as its own git repo, published on GitHub as `wealth-manager`.** It is a pnpm workspace with `server/` and `client/`, like meals-planner.
10. **Carry-forward rule (new, from your answer on partial failures).** When a lookup fails, the engine reuses the last known value for the failing part and marks the line `stale`. Details are in Success Criteria #9. Two cases I'm deciding for you, so correct me if wrong:
    - A new entry with no previous value to carry forward is left out of the snapshot and listed as a failure, rather than valued at 0.
    - If the USD/EUR rate lookup fails, the last known rate is carried forward and flagged. If no rate has ever been stored, no snapshot is written.
11. **No live network calls in tests or CI.** Providers are tested against recorded fixtures.
12. **Provider API keys:** the daily snapshot runs on keyless providers only. The one required key is a free Blockscout key for the **Base token scan**, which is an interactive feature and not part of the cron (decided 2026-11-19). If it is not set, the Base scan is disabled with a clear message, and Base tokens can still be added by contract address. Other keys (for example CoinGecko) are accepted later and go in env vars.

## Objective

A web app that takes one snapshot a day of everything the owner holds and charts how net worth evolves in USD and EUR.

- **User:** the owner only, behind one password. Others can fork the repo and self-host.
- **v1 scope:** BTC, ETH and Base addresses, with native coins and ERC-20 tokens.
- **Later:** Aave, forex, bank accounts and stocks. Each new asset type is a new "source type" plugged into the same snapshot engine, with its own admin page.

### User stories

1. As the owner, I log in with one password and land on a dashboard showing the latest total in USD and EUR, the change vs yesterday and vs 7 days ago, a history chart, and a breakdown by asset.
2. As the owner, I open **Admin → Crypto** and add an address (label, chain, address). For ETH and Base the app scans it and lists tokens above the value threshold. I tick the ones to track.
3. As the owner, I can add a token by contract address (chain, contract), edit a label, pause an entry, or delete it. Pausing keeps history. Deleting asks for confirmation.
4. As the owner, I configure a cron on o2switch that calls the snapshot endpoint once a day, and the chart gains one point per day.
5. As a fork user, I follow the README and get my own instance without touching the code.

### Not building (v1)

Backfilling past balances, trade history, taxes, P&L, multi-user accounts, 2FA, Aave, forex, bank accounts, stocks, chains other than BTC/ETH/Base, NFTs, BTC xpubs.

## Tech Stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm 10.10 workspaces (`server/`, `client/`) |
| Server | Node 20, Fastify 5, TypeScript 5.8 (`module: NodeNext`, `strict`), `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/static`, `bcryptjs`, `dotenv` |
| DB | PostgreSQL 16, native `pg` (no ORM, no WASM or engines, because of o2switch memory limits), `node-pg-migrate` |
| Client | React 19, TypeScript, Vite 6, MUI, React Router |
| Charts | Recharts (approved). Colors and layout follow the `dataviz` skill. |
| Tests | Jest 29 + ts-jest (server), Vitest or equivalent for the client if needed |
| CI | GitHub Actions: build and package artifacts, same layout as meals-planner |

## Commands

Mirrors meals-planner.

```
Install:        pnpm install
Dev (all):      pnpm dev
Dev server:     pnpm dev:server          # tsx watch src/index.ts
Dev client:     pnpm dev:client          # vite
Dev DB:         pnpm dev:db              # docker compose up -d (postgres:16-alpine)
Build:          pnpm build               # tsc (server + migrations) then vite build
Test:           pnpm test                # jest in server/
Lint:           pnpm --filter server lint
Migrate (dev):  pnpm db:migrate          # node-pg-migrate up -m migrations
Migrate (prod): pnpm --filter server migrate:prod   # run from the cPanel Node.js app screen
Hash password:  pnpm hash-password       # prints the bcrypt hash for APP_PASSWORD_HASH
Run snapshot:   pnpm --filter server snapshot:run    # same engine as the endpoint, for local debugging
```

Production cron (configured by the owner in cPanel):

```
curl -fsS -X POST -H "Authorization: Bearer $SNAPSHOT_TOKEN" https://portfolio.<domain>/api/snapshots/run
```

## Project Structure

```
portfolio/
├── SPEC.md
├── docs/intent/portfolio.md       → confirmed statement of intent
├── README.md                      → stack, local dev, o2switch deploy, cron setup
├── LICENSE
├── .env.example
├── docker-compose.yml             → dev PostgreSQL only
├── .github/workflows/build-artifacts.yml   → CI build + package (same layout as meals-planner)
├── pnpm-workspace.yaml
├── server/
│   ├── server.js                  → Passenger entry (forces NODE_ENV=production)
│   ├── migrations/                → node-pg-migrate files
│   └── src/
│       ├── index.ts               → Fastify bootstrap, static client, route registration
│       ├── db/                    → pg pool + query helper
│       ├── lib/
│       │   ├── auth.ts            → password login, sessions, requireAuth, snapshot-token check
│       │   ├── money.ts           → decimal helpers, USD↔EUR conversion
│       │   └── snapshot.ts        → snapshot engine (source-type agnostic)
│       ├── sources/               → one folder per asset type (the plug-in point)
│       │   ├── types.ts           → SourceType interface
│       │   └── crypto/            → addresses, token scan, chain adapters, price adapters
│       └── routes/                → auth, snapshots, dashboard, admin-crypto
├── client/
│   └── src/
│       ├── pages/                 → Login, Dashboard, admin/Crypto (later admin/Bank, …)
│       └── components/
└── scripts/                       → hash-password, backup (optional, copied from meals-planner)
```

### Core data model (sketch, finalized in the plan)

- `Session(id, token, expiresAt, createdAt)`
- `CryptoAddress(id, label, chain, address, active, createdAt)`, unique on `(chain, address)`
- `CryptoAsset(id, addressId, kind native|token, symbol, contractAddress?, decimals, active, hidden)`, which holds the tokens the owner chose to track
- `IgnoredToken(id, chain, contractAddress, createdAt)`, unique on `(chain, contractAddress)`: the manual "ignore this token" list, which the scan never offers again
- `Setting(key, value)`: holds the scan threshold (default `10`, USD)
- `Snapshot(id, date UNIQUE, usdPerEur, rateStale bool, totalUsd, totalEur, status complete|partial, createdAt)`
- `SnapshotLine(id, snapshotId, sourceType, sourceRef, symbol, amount NUMERIC, priceUsd NUMERIC, valueUsd NUMERIC, valueEur NUMERIC, stale bool, staleSince date NULL)`

Snapshot lines are denormalized on purpose: history must not change when an address is later renamed or deleted.

`stale` means the line was carried forward from an earlier snapshot because a fresh lookup failed. `staleSince` is the date of the last good fetch. A carried-forward line keeps the previous `amount`, `priceUsd` and `valueUsd`, and recomputes `valueEur` with the current rate. A snapshot is `partial` if any line is stale or any entry was left out.

### Extensibility contract

```ts
export interface SourceType {
  id: 'crypto' | 'aave' | 'forex' | 'bank' | 'stocks'
  /** Return every active holding, valued in USD. Must not throw for one bad entry. */
  collect(ctx: SnapshotContext): Promise<CollectResult>
}

export interface CollectResult {
  lines: HoldingLine[]            // successfully valued holdings
  failures: { ref: string; reason: string }[]   // refs the engine will try to carry forward
}
```

The snapshot engine runs every registered `SourceType`, converts to EUR, and writes one `Snapshot` plus lines. For each `failures` entry it looks up that `sourceRef`'s line in the most recent earlier snapshot and carries it forward as `stale`. If there is none, the entry is left out and reported. Because carry-forward lives in the engine, every future source type gets it for free. Adding a source type means adding a folder under `sources/`, a route and a client admin page. It does not mean changing the engine.

## Code Style

Follow meals-planner: TypeScript strict, Fastify plugin per route file, raw SQL with parameterized queries, camelCase quoted columns, prefixed ids via `generateId`, and `requireAuth` at the top of every protected handler.

```ts
export const cryptoAdminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/addresses', async (request, reply) => {
    await requireAuth(request, reply)
    const { label, chain, address } = (request.body as Partial<NewAddress>) || {}

    if (!isChain(chain) || !isValidAddress(chain, address)) {
      return reply.status(400).send({ error: 'Valid chain and address are required' })
    }

    try {
      const res = await query(
        `INSERT INTO "CryptoAddress" ("id", "label", "chain", "address", "createdAt")
         VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
        [generateId('ca'), label?.trim() || null, chain, normalizeAddress(chain, address)]
      )
      return reply.status(201).send({ address: res.rows[0] })
    } catch (err: any) {
      if (err.code === '23505') return reply.status(409).send({ error: 'Address already tracked' })
      throw err
    }
  })
}
```

Conventions:
- Files are kebab-case, types PascalCase, and 2-space indent with no semicolons (matches the reference).
- Validate and normalize every input at the route boundary (chain enum, address format, EIP-55 or lowercase for EVM, contract address format).
- External API calls live in `sources/*/` adapters behind interfaces and are never called directly from routes.
- Errors from one provider never abort the whole snapshot (see Success Criteria).

## Testing Strategy

| Level | What | How |
|---|---|---|
| Unit | decimal and FX math, threshold filtering, spam and unpriced flagging, address validation, day-bucket logic | Jest, pure functions |
| Adapter | BTC, Blockscout and CoinGecko/Frankfurter parsing | Jest with recorded JSON fixtures, no live network |
| Integration | snapshot engine upsert and idempotency, partial-failure behavior, auth, snapshot-token guard | Jest against a real PostgreSQL (docker, same image as dev), with fake source adapters |
| Manual / e2e | login → add address → pick tokens → run snapshot → chart shows a point | One scripted walkthrough in the README checklist. Playwright only if the owner wants it. |

Coverage: no numeric gate. The snapshot engine, money helpers and auth guards must be covered by tests before the code is merged. Tests live next to the code as `*.test.ts`, as in meals-planner.

## Boundaries

**Always**
- Run `pnpm build` and `pnpm test` before committing.
- Use parameterized SQL only.
- Keep secrets in env vars, never in the repo or the DB: `DATABASE_URL`, `APP_PASSWORD_HASH`, `SNAPSHOT_TOKEN`, and the optional `COINGECKO_API_KEY`.
- Treat provider response data (token names and symbols) as untrusted. Escape it in the UI and never use it as instructions or markup.
- Rate-limit `POST /api/auth/login` and compare the snapshot token in constant time.

**Ask first**
- Adding any new runtime dependency (Recharts is already approved).
- Any schema change after the first migration is deployed.
- Changing the CI workflow or the artifact layout.
- Switching a data provider, or adding one that needs an API key.

**Never**
- Commit `.env`, real addresses, real balances or tokens (the owner's addresses stay in the DB, not in fixtures).
- Use floats for money, or silently write a `0` when a fetch fails.
- Build or install on the o2switch server (CI builds artifacts, per the reference setup).
- Add Aave, forex, bank, stocks, NFT, backfill or P&L features in v1 without a spec update.
- Remove or skip a failing test without approval.

## Success Criteria

Each is specific and testable.

1. **Auth:** With a wrong password, `/api/auth/login` returns 401 and sets no cookie. With the right one it returns 200 and an httpOnly cookie. Every non-auth `/api/*` route returns 401 without a session, except the snapshot endpoint, which requires the bearer token instead. After 10 failed logins within a minute from one IP, the endpoint returns 429.
2. **Snapshot guard:** `POST /api/snapshots/run` returns 401 with a missing or wrong token and 200 with the right one. A session cookie alone does not authorize it.
3. **Add address:** A valid BTC, ETH or Base address is stored. A malformed address returns 400 and a duplicate `(chain, address)` returns 409.
4. **Token scan:** For an ETH or Base address, the scan returns the tokens whose USD value is at or above the threshold (default $10, configurable in the UI and stored in the DB). Tokens with no price are listed in a separate "unpriced" group and are not selected by default. Tokens flagged as spam by the provider, or present in the ignore list, are hidden behind a "show hidden" toggle. A token can be added to the ignore list from the scan or from the address's tracked-token list, and an ignored token is never offered by later scans.
5. **Manual token:** Adding a token by `(chain, contract)` reads its symbol and decimals from the chain data. A contract with no price is accepted but flagged "unpriced" and valued at 0 with a visible warning, not hidden.
6. **Pause / delete:** A paused address or token is skipped by new snapshots and its past snapshot lines are unchanged. A deleted one also leaves past lines unchanged.
7. **Snapshot correctness:** For fixture inputs (balances, prices, rate), the stored `totalUsd`, `totalEur` and per-line values match hand-computed expected values to the stored precision, using `usdPerEur` saved on the snapshot.
8. **Idempotency:** Calling the endpoint twice on the same UTC date leaves exactly one `Snapshot` row for that date, holding the second call's values.
9. **Failure handling (carry forward):**
   - If a balance or price lookup fails for an entry that has an earlier snapshot line, the engine writes the snapshot with that line carried forward from the most recent earlier snapshot. The line has `stale = true` and `staleSince` set to the date of the last good fetch, and the snapshot has `status = partial`. The endpoint's response lists each stale entry and the reason.
   - A carried-forward line keeps the old `amount`, `priceUsd` and `valueUsd`. Its `valueEur` is recomputed with the current rate.
   - If a failing entry has no earlier line (for example an address added today), it is left out of the snapshot and listed in the response. It is never written as 0.
   - If the USD/EUR rate lookup fails, the most recent stored `usdPerEur` is reused and the snapshot has `rateStale = true` and `status = partial`. If no rate has ever been stored, no snapshot is written and the endpoint returns a 5xx.
   - The dashboard shows a warning on any partial snapshot and marks stale lines in the breakdown with their `staleSince` date. The endpoint returns 200 for a partial snapshot, so cron treats it as success.
   - A later successful run on the same UTC date replaces the partial snapshot, so stale lines clear up as soon as a retry succeeds.
10. **Dashboard:** It shows the latest total in USD and EUR, 1-day and 7-day change (or "n/a" when history is shorter), a time-series chart with a USD/EUR toggle, and a per-asset breakdown for the selected snapshot. With a single snapshot, it renders without error.
11. **Extensibility:** A test registers a fake second `SourceType` and checks that its lines appear in the snapshot totals without any change to engine code.
12. **Deploy:** CI on push to `main` produces `server-artifact.zip` and `client-artifact.zip`. Extracting both on o2switch, setting the env vars, running `migrate:prod` and restarting gives a working login over HTTPS. The README documents each step, including the cron line.
13. **Open-source hygiene:** The repo has a README, LICENSE and `.env.example`, and contains no secrets or personal addresses. A fresh clone gets to a running local instance with only the README steps.

## Open Questions

Resolved by the owner:

1. Chart library: Recharts, with the owner's "OK". It's a new dependency, so it is approved here.
2. Day boundary: UTC.
3. Partial snapshots: carry forward the last known value (see Success Criteria #9).
4. BTC xpubs: not in v1, plain addresses only.
5. Provider keys: a free key may be added later if rate limits bite.
6. Spam: the provider's spam flag, the value threshold and a manual ignore list, all three.
7. License: MIT.
8. Repo name: `wealth-manager`.

Still open (decided by default, tell me if you disagree):

- A new entry with no history that fails its first lookup is left out of the snapshot and reported, not valued at 0.
- If the FX rate fails, the last stored rate is carried forward and flagged, and no snapshot is written only if no rate has ever been stored.
