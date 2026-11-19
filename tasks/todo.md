# Task list: wealth-manager

Plan: [plan.md](plan.md). Spec: [../SPEC.md](../SPEC.md). Criteria numbers (SC#) refer to the spec's Success Criteria.
Size key: S = 1-2 files, M = 3-5 files.

## Phase 1: Foundation

- [x] **T1: Server scaffold and dev database** (M)
  - Description: pnpm workspace, Fastify 5 server skeleton with health route, `pg` pool and query helper, `node-pg-migrate` wiring, Jest, dev PostgreSQL in docker, `.env.example`, `.gitignore`, MIT `LICENSE`.
  - Acceptance:
    - [ ] `pnpm dev:db` starts PostgreSQL 16, `pnpm dev:server` serves `GET /api/health` returning 200 and DB connectivity status
    - [ ] `pnpm db:migrate` runs with an initial empty-safe migration and creates `pgmigrations`
    - [ ] No secrets committed, `.env` is gitignored
  - Verify: `pnpm build && pnpm test`, then `curl localhost:<port>/api/health`
  - Dependencies: none
  - Files: `package.json`, `pnpm-workspace.yaml`, `server/package.json`, `server/tsconfig.json`, `server/src/index.ts`, `server/src/db/index.ts`, `docker-compose.yml`, `.env.example`, `.gitignore`, `LICENSE`

- [x] **T2: Client scaffold** (S)
  - Description: React 19 + Vite 6 + TypeScript + MUI + React Router app shell with a dev proxy to the server.
  - Acceptance:
    - [ ] `pnpm dev:client` renders a placeholder page that calls `/api/health` and shows the result
    - [ ] `pnpm build` produces `client/dist`
  - Verify: `pnpm build`, open the dev URL
  - Dependencies: T1
  - Files: `client/package.json`, `client/vite.config.ts`, `client/src/main.tsx`, `client/src/App.tsx`, `client/tsconfig.json`

- [x] **T3: Provider spike (docs only, no app code)** (S)
  - Description: Verify the current docs and free-tier limits for Blockstream/mempool.space, Blockscout (ETH and Base), CoinGecko and Frankfurter. Confirm: BTC balance endpoint, EVM native balance, token balances with a spam flag, price by contract on `ethereum` and `base`, rate limits. Save findings and sample responses (with made-up addresses) as fixtures.
  - Acceptance:
    - [ ] `docs/providers.md` lists, per provider, the exact endpoints, limits and gotchas, with doc links
    - [ ] Fixtures saved under `server/src/sources/crypto/__fixtures__/`
    - [ ] Any provider that does not fit is called out with a proposed alternative
  - Verify: owner reads `docs/providers.md`. If a provider changes, the plan and spec are updated before T10.
  - Dependencies: T1
  - Files: `docs/providers.md`, `server/src/sources/crypto/__fixtures__/*.json`

- [x] **T4: Auth API (password login, sessions, rate limit)** (M)
  - Description: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `Session` migration, `requireAuth`, and `pnpm hash-password`. Session tokens are stored as SHA-256 hashes. Tests run against a separate `wealthmanager_test` database that Jest creates and migrates itself.
  - Acceptance:
    - [x] Wrong password returns 401 with no cookie. Right password returns 200 with an httpOnly cookie (`Secure` in production) (SC1)
    - [x] Protected routes return 401 without a session (SC1)
    - [x] 10 failed logins in a minute from one IP returns 429 (SC1)
    - [x] Missing `APP_PASSWORD_HASH` makes the server refuse to start with a clear message
  - Verify: `pnpm --filter server test` (integration tests on real PostgreSQL)
  - Dependencies: T1
  - Files: `server/migrations/002_session.ts`, `server/src/lib/auth.ts`, `server/src/routes/auth.ts`, `server/src/lib/auth.test.ts`, `scripts/hash-password.mjs`

- [x] **T5: Login UI and route guard** (S)
  - Description: Login page, auth context, protected-route wrapper, logout.
  - Acceptance:
    - [x] Unauthenticated visit redirects to `/login` (route guard in code; not yet seen in a browser)
    - [x] Correct password lands on an empty dashboard page. Wrong password shows an error (API flow verified through the Vite proxy; rendered UI not yet seen in a browser)
  - Verify: manual walkthrough against the dev server
  - Dependencies: T2, T4
  - Files: `client/src/pages/Login.tsx`, `client/src/lib/auth.tsx`, `client/src/App.tsx`, `client/src/lib/api.ts`

### Checkpoint A: Foundation
- [ ] `pnpm build` and `pnpm test` pass
- [ ] Login works end to end locally
- [ ] `docs/providers.md` reviewed by owner and plan adjusted if needed

## Phase 2: Snapshot engine

- [x] **T6: Money helpers and FX adapter** (M)
  - Description: Decimal helpers (`decimal.js`) and the USD/EUR rate adapter (Frankfurter) behind an interface. Frankfurter returns EUR per USD, so the adapter inverts it once to the stored `usdPerEur` (8 decimals, ROUND_HALF_UP).
  - Acceptance:
    - [x] USD to EUR conversion is exact against hand-computed fixtures, with no float artifacts
    - [x] FX adapter parses the fixture and rejects malformed or zero rates
  - Verify: `pnpm --filter server test`
  - Dependencies: T1, T3
  - Files: `server/src/lib/money.ts`, `server/src/lib/money.test.ts`, `server/src/sources/fx/frankfurter.ts`, `server/src/sources/fx/frankfurter.test.ts`

- [x] **T7: Snapshot schema and engine (with carry-forward)** (M)
  - Description: `Snapshot` and `SnapshotLine` migration, `SourceType` interface and registry, engine that collects, converts, carries forward failures and replaces one snapshot per UTC date in a transaction. Network calls happen before the transaction, and an advisory lock serializes overlapping runs. DATE columns are returned as strings.
  - Acceptance:
    - [x] Totals and per-line values match hand-computed expectations (SC7)
    - [x] Same-day second run leaves one row with the second run's values (SC8)
    - [x] Failed entry with history is carried forward as `stale` with `staleSince`, snapshot is `partial`. Failed entry with no history is left out and reported, never 0 (SC9)
    - [x] FX failure reuses the last rate with `rateStale`. No rate ever stored means no snapshot (SC9)
    - [x] A later successful same-day run clears stale lines (SC9)
    - [x] A fake second `SourceType` is included in totals with no engine change (SC11)
  - Verify: `pnpm --filter server test` (integration tests on real PostgreSQL with fake sources)
  - Dependencies: T6
  - Files: `server/migrations/003_snapshot.ts`, `server/src/sources/types.ts`, `server/src/lib/snapshot.ts`, `server/src/lib/snapshot.test.ts`

- [x] **T8: Token-guarded snapshot endpoint** (S)
  - Description: `POST /api/snapshots/run` with a bearer `SNAPSHOT_TOKEN` compared in constant time (digest comparison), calling the engine. Plus the `snapshot:run` script. If no rate was ever stored the endpoint returns 503 and writes nothing.
  - Acceptance:
    - [x] Missing or wrong token returns 401. A session cookie alone returns 401 (SC2)
    - [x] Valid token returns 200 with a summary (date, totals, stale and left-out entries). A partial snapshot also returns 200 (SC9)
    - [x] Server refuses to start without `SNAPSHOT_TOKEN` (and rejects one shorter than 32 characters)
  - Verify: `pnpm --filter server test`, then `curl -X POST -H "Authorization: Bearer …" localhost:<port>/api/snapshots/run`
  - Dependencies: T4, T7
  - Files: `server/src/routes/snapshots.ts`, `server/src/routes/snapshots.test.ts`, `server/src/index.ts`, `server/src/scripts/snapshot-run.ts`

### Checkpoint B: Engine
- [x] Engine passes all carry-forward and idempotency tests
- [x] A curl with the token produces a snapshot (live Frankfurter rate, no source registered yet, so zero lines). Fake-source totals are covered by the endpoint tests
- [ ] Review with owner before building the crypto source

## Phase 3: Crypto source

- [x] **T9: Crypto addresses API** (M)
  - Description: `CryptoAddress` and `CryptoAsset` migration, plus CRUD for addresses (add, edit label, pause, delete) with chain and address validation and normalization. Format-only validation (no checksum). Adding an address also creates its native asset row. Request bodies reject unknown fields with 400 (app-wide Ajv `removeAdditional: false`).
  - Acceptance:
    - [x] Valid BTC, ETH and Base addresses are stored (EVM lowercased). Malformed returns 400, duplicate `(chain, address)` returns 409 (SC3)
    - [x] Pause and delete never touch `SnapshotLine` rows (SC6)
    - [x] All routes require a session (SC1)
  - Verify: `pnpm --filter server test`
  - Dependencies: T4
  - Files: `server/migrations/004_crypto.ts`, `server/src/sources/crypto/addresses.ts`, `server/src/routes/admin-crypto.ts`, `server/src/routes/admin-crypto.test.ts`, `server/src/sources/crypto/validate.ts`

- [x] **T10: Balance and price adapters** (M)
  - Description: Interfaces plus adapters, built on the T3 findings ([docs/providers.md](../docs/providers.md)): `btc.ts` (mempool.space, confirmed balance in sats), `evm-rpc.ts` (batched JSON-RPC: native balance, ERC-20 `balanceOf`, `decimals()` and `symbol()` including bytes32 symbols, with a configurable fallback RPC URL per chain), and `coingecko.ts` (native and by-contract prices, where a missing key means unpriced). The Blockscout scan adapter is built in T12, not here.
  - Acceptance:
    - [x] Each adapter parses its recorded fixtures into typed results using decimal strings
    - [x] Provider errors, timeouts and malformed bodies raise typed errors and never return a silent 0 (a failing token is reported per token, a failing native balance fails the address)
    - [x] Per-provider request timeout and a small concurrency cap are enforced
  - Verify: `pnpm --filter server test` (fixtures only, no live network)
  - Dependencies: T3, T6
  - Files: `server/src/sources/crypto/providers/btc.ts`, `.../evm-rpc.ts`, `.../coingecko.ts`, `.../http.ts`, `.../types.ts`, `.../providers.test.ts`

- [x] **T11: Crypto `SourceType` (native coins) wired into the engine** (S)
  - Description: Implement `collect()` for active addresses and their native coin, using the adapters, and register it. First real snapshot.
  - Acceptance:
    - [x] With fake adapters, a snapshot contains one line per active address, with values matching hand-computed numbers
    - [x] A failing address is reported in `failures`, and the engine carries it forward (SC9). If the price lookup fails, every entry fails rather than being priced at 0
    - [x] Paused addresses are skipped (SC6)
  - Verify: `pnpm --filter server test`. Optional smoke run against live providers with the owner's own address, kept out of the repo.
  - Dependencies: T8, T9, T10
  - Files: `server/src/sources/crypto/index.ts`, `server/src/sources/crypto/index.test.ts`, `server/src/sources/register-defaults.ts` (one registration line per source type, called from `start()` and `snapshot:run`)

- [x] **T12: Token scan API and threshold setting** (M)
  - Description: `POST /api/admin/crypto/addresses/:id/scan` returns tokens grouped as above-threshold, unpriced, and hidden (spam or ignored). Adds the `blockscout.ts` scan adapter (Ethereum keyless, Base with `BLOCKSCOUT_API_KEY`), keeps only `ERC-20` entries, uses a 60 s timeout because big wallets take about 25 s, and returns a clear "Base scan disabled, no key set" result when the key is missing. `Setting` and `IgnoredToken` migration, threshold get/set, ignore and unignore.
  - Acceptance:
    - [x] Tokens at or above the threshold (default $10, configurable) are returned as selectable (SC4)
    - [x] Unpriced tokens are in a separate group and not preselected. Spam-flagged and ignored tokens are hidden by default (SC4)
    - [x] An ignored token never appears in a later scan's default list
    - [x] BTC addresses return an empty scan, not an error (Base without a key returns a "disabled" result with a message, also not an error. The Base request shape is from the docs only, see providers.md)
  - Verify: `pnpm --filter server test` (fixtures)
  - Dependencies: T9, T10
  - Files: `server/migrations/005_settings_ignored.ts`, `server/src/sources/crypto/scan.ts`, `.../settings.ts`, `.../providers/blockscout.ts`, `server/src/routes/admin-crypto.ts`, `server/src/sources/crypto/scan.test.ts`

- [x] **T13: Tracked tokens, manual add, and token valuation** (M)
  - Description: Save the tokens the owner selects, add a token by `(chain, contract)` (symbol and decimals read from chain data), pause and delete tokens, and include tracked tokens in the crypto `collect()`.
  - Acceptance:
    - [x] Selected tokens appear in the next snapshot as their own lines (SC7)
    - [x] Manual add reads symbol and decimals. An unpriced contract is accepted, flagged, valued at 0 with a visible warning (SC5)
    - [x] Pause and delete keep past lines unchanged (SC6)
    - [x] Symbols and names are length-capped on write
  - Verify: `pnpm --filter server test`
  - Dependencies: T11, T12
  - Files: `server/src/routes/admin-crypto.ts`, `server/src/sources/crypto/tokens.ts`, `server/src/sources/crypto/index.ts`, `server/src/sources/crypto/tokens.test.ts`

- [x] **T14: Admin → Crypto UI (addresses)** (M)
  - Description: Admin page listing addresses with add, edit label, pause and delete (with confirm), plus a per-address last-value display.
  - Acceptance:
    - [x] Add, edit, pause and delete work against the real API, with validation errors shown inline (UI compiles and the API is tested; the rendered page is not yet seen in a browser)
    - [x] Labels and other provider-sourced strings are rendered as text, never as HTML
    - [x] The page lives under an admin nav that later source types can join
  - Verify: manual walkthrough on the dev server, `pnpm build`
  - Dependencies: T5, T9
  - Files: `client/src/pages/admin/Crypto.tsx`, `client/src/components/AdminNav.tsx`, `client/src/lib/api.ts`, `client/src/App.tsx`

- [x] **T15: Admin → Crypto UI (token selection)** (M)
  - Description: After adding an EVM address, show the scan results with checkboxes (above threshold preselected), an "unpriced" group, a "show hidden" toggle, ignore buttons, a manual add-by-contract form, and the threshold setting.
  - Acceptance:
    - [x] Adding an ETH or Base address opens the selection dialog. Confirming saves the selected tokens (SC4)
    - [x] Manual add-by-contract works and shows the unpriced warning when relevant (SC5)
    - [x] Threshold change takes effect on the next scan
  - Verify: manual walkthrough with fixture-backed dev adapters, `pnpm build`
  - Dependencies: T13, T14
  - Files: `client/src/pages/admin/Crypto.tsx`, `client/src/components/TokenScanDialog.tsx`, `client/src/components/AddTokenForm.tsx`, `client/src/lib/api.ts`

### Checkpoint C: First real snapshot
- [ ] All tests pass and the build is clean
- [ ] With the owner's real addresses (kept out of the repo), running the snapshot gives plausible totals
- [ ] Add address, pick tokens, run snapshot works end to end in the UI
- [ ] Review with owner before the dashboard

## Phase 4: Dashboard

- [ ] **T16: Dashboard API** (S)
  - Description: `GET /api/dashboard` returning the latest totals, 1-day and 7-day change (or null when history is shorter), the time series, and the per-asset breakdown for a given date, with stale and partial markers.
  - Acceptance:
    - [ ] With 0 snapshots, 1 snapshot and many snapshots, the response is correct and never errors (SC10)
    - [ ] Changes are computed in decimal math from stored values
    - [ ] Stale lines carry `staleSince`
  - Verify: `pnpm --filter server test`
  - Dependencies: T11
  - Files: `server/src/routes/dashboard.ts`, `server/src/routes/dashboard.test.ts`

- [ ] **T17: Dashboard UI** (M)
  - Description: Totals card, 1-day and 7-day change, Recharts time series with a USD/EUR toggle, per-asset breakdown, partial-snapshot warning. Follows the `dataviz` skill.
  - Acceptance:
    - [ ] Renders correctly with 0, 1 and many snapshots (SC10)
    - [ ] USD/EUR toggle switches the chart and totals
    - [ ] Partial snapshots show a warning, and stale lines show their `staleSince` date
    - [ ] Colors are accessible in light and dark
  - Verify: manual walkthrough with seeded snapshots, `pnpm build`
  - Dependencies: T5, T16
  - Files: `client/src/pages/Dashboard.tsx`, `client/src/components/NetWorthChart.tsx`, `client/src/components/Breakdown.tsx`, `client/package.json` (Recharts)

### Checkpoint D: Usable app
- [ ] Dashboard shows real data from a local run
- [ ] Owner confirms the numbers and layout before shipping work

## Phase 5: Ship

- [ ] **T18: Production serving and CI artifacts** (M)
  - Description: Serve `client/dist` from Fastify in production, add the Passenger `server.js` entry, `migrate:prod`, and the GitHub Actions workflow that builds `server-artifact` and `client-artifact` in the meals-planner layout.
  - Acceptance:
    - [ ] A local production-mode run serves the SPA and the API from one process, and SPA routes fall back to `index.html`
    - [ ] CI produces both artifacts with the expected top-level `server/` and `client/` folders
    - [ ] Cookie is `Secure` in production, and the server runs behind HTTPS only
  - Verify: `pnpm build && NODE_ENV=production node server/dist/index.js`, plus a CI run on a branch
  - Dependencies: T8, T17
  - Files: `server/server.js`, `server/src/index.ts`, `.github/workflows/build-artifacts.yml`, `server/package.json`

- [ ] **T19: README, deploy guide and open-source hygiene** (S)
  - Description: README with stack, local dev, o2switch steps (adapted from meals-planner), the cron line, backup note, env var table, and a repo scan for secrets and personal data.
  - Acceptance:
    - [ ] A fresh clone reaches a running local instance using only the README (SC13)
    - [ ] Env vars documented: `DATABASE_URL`, `APP_PASSWORD_HASH`, `SNAPSHOT_TOKEN`, optional `COINGECKO_API_KEY`
    - [ ] No secrets, real addresses or balances anywhere in the repo or history
  - Verify: follow the README on a clean checkout, grep for secrets
  - Dependencies: T18
  - Files: `README.md`, `.env.example`, `LICENSE`

### Checkpoint E: Done
- [ ] Spec Success Criteria 1 to 13 all met
- [ ] Deployed on o2switch with the cron configured by the owner, and one real daily snapshot recorded
- [ ] Owner decides when to publish `wealth-manager` on GitHub
