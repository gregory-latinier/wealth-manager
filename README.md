# Wealth Manager

A personal, single-owner net-worth tracker. A daily cron calls one API endpoint, which snapshots everything you hold, and the dashboard charts the evolution in **USD and EUR**.

Built to be self-hosted on cheap shared hosting ([o2switch](https://www.o2switch.fr/), Phusion Passenger), but it runs anywhere Node.js and PostgreSQL do.

> One owner, one password. There is no sign-up, no multi-user mode and no 2FA. Do not expose it without HTTPS.

## What it does (v1)

- Tracks **crypto addresses**: BTC, ETH, Base and BNB Chain. Native coins plus ERC-20/BEP-20 tokens.
- Adding an address scans it for tokens worth more than a USD threshold (default about $10). You pick which to track, or add one by contract address.
- A daily snapshot records every holding, its price and its value in USD and EUR.
- The dashboard shows the total, the 1-day and 7-day change, the evolution chart, and the holdings of any day.
- If a provider fails, the last known value is carried forward and marked **stale**, so one outage never leaves a hole in the chart.

Out of scope for v1: backfilling history, trades, taxes and P&L, other chains, NFTs, BTC xpubs. Other source types (Aave, forex, bank, stocks) are meant to plug in later as new `SourceType`s.

## Stack

| | |
|---|---|
| Server | Fastify 5, TypeScript, native `pg` (no ORM), `node-pg-migrate` |
| Client | React 19, Vite, MUI, React Router, Recharts |
| Database | PostgreSQL 16 |
| Monorepo | pnpm workspaces (`server/`, `client/`) |
| Tests | Jest on a real PostgreSQL |

Data providers, all keyless by default (see [`docs/providers.md`](docs/providers.md) for what was verified):

| Need | Provider |
|---|---|
| BTC balance | mempool.space |
| ETH, Base and BNB Chain balances | public JSON-RPC (override with your own endpoint) |
| Token prices | DefiLlama (keyless, batched), CoinGecko as fallback |
| Native prices (BTC, ETH, BNB) | CoinGecko |
| Token scan on Ethereum | Blockscout |
| Token scan on Base and BNB Chain | A built-in list of popular tokens, read over RPC, priced by DefiLlama. Keyless. Other tokens: add by contract address. |
| Exchange balances | Kraken private API with a read-only key (spot, including staked). OKX is the next adapter. |
| Exchange prices | Kraken public `AssetPairs` and `Ticker` |
| Smardex leveraged positions | Read on-chain over the Ethereum RPC. Positions are found from the address's history on Blockscout, then valued by the protocol contract and priced in wstETH by DefiLlama. Keyless. |
| USD/EUR rate | Frankfurter |

## Local development

Requirements: Node.js 20 or later, pnpm 10, Docker (for PostgreSQL).

```bash
pnpm install
cp .env.example .env          # then edit it, see below
pnpm dev:db                   # PostgreSQL on localhost:5433
pnpm db:migrate               # apply the migrations
pnpm dev                      # server on :3001, client on :5173
```

Open http://localhost:5173 and log in.

### Choose your password

The simplest option is the password itself in `.env` (8 characters or more):

```env
APP_PASSWORD=your-password
```

That is fine for a personal app on a machine you control. If you would rather not keep the password in clear text, store a bcrypt hash instead:

```bash
pnpm hash-password            # prompts, input hidden, minimum 12 characters
```

Wrap the value in **single quotes** in `.env`, because a bcrypt hash contains `$`:

```env
APP_PASSWORD_HASH='$2b$12$...'
```

When `APP_PASSWORD` is set it is used and the hash variables are ignored.

Generate the snapshot token with `openssl rand -hex 32`.

The server refuses to start without a password (`APP_PASSWORD` or a valid hash) and a `SNAPSHOT_TOKEN` of at least 32 characters.

### Track an exchange

1. Set `EXCHANGE_KEY_SECRET` in `.env` and restart the server. Run `pnpm db:migrate` once (creates the `ExchangeAccount` table).
2. On the exchange, create an API key that can only **read**. On Kraken: Security > API, tick only **Query funds**, leave trading, deposit and withdrawal off.
3. Open **Exchanges** in the app and choose **Connect exchange**. The key is checked with the exchange before it is saved, then stored encrypted (AES-256-GCM). It is never shown again and never sent back to the browser.

Every spot balance on the account is tracked, including staked and earn balances (counted as the base asset, so `ETH2.S` is valued as ETH). Fiat is counted as cash. An asset with no USD price on the exchange is carried forward from its last value and marked stale, never valued at 0. If the exchange cannot be reached the whole account is carried forward the same way.

The database holds ciphertext only, but anyone with both the database and `EXCHANGE_KEY_SECRET` can read the keys. That is why a read-only key matters: it can see balances and nothing else.

### Track Smardex leveraged positions

Run `pnpm db:migrate` once (creates `SmardexWallet`, and the `SmardexScan` / `SmardexPosition` cache tables), then open **Smardex** in the app and choose **Add wallet** with the Ethereum address you trade from. It does not have to be listed under Crypto. Each active wallet is checked for open long positions on the Smardex USDN market (WSTETH_USDN), including positions parked in LongFarming. A switch pauses a wallet, and removing one also clears its position cache (snapshot history is kept).

Each open position is one line (symbol `wstETH`), valued by the protocol's own `getPositionValue` at the current wstETH price, so it is the position's net value (collateral plus profit or loss), not the size of the trade. A position that is closed or liquidated is skipped. One that is under water counts as 0, not as a debt. If the contract, the price or the history cannot be read, the position keeps its last value and is marked stale. The first snapshot reads the whole transaction history (about 15 s for a busy wallet). Later ones read only new transactions.

Under the wallet list, the page also shows each open position in detail: opening date, collateral, leverage, entry price, liquidation price, what it is worth if closed now, and the profit or loss in wstETH and in USD. These are read live when you open the page (the first time for a wallet can take about 30 s). The figures are estimates: closing fees and gas are not included.

### Record a snapshot by hand

After adding an address under **Crypto**:

```bash
pnpm snapshot:run
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. The local default is `postgresql://wmuser:wmpassword@localhost:5433/wealthmanager`, matching `docker-compose.yml`. |
| `APP_PASSWORD` | yes* | Your password in plain text, 8 characters or more. Wins over the hash variables when set. |
| `APP_PASSWORD_HASH` | yes* | Alternative to `APP_PASSWORD`: bcrypt hash of your password (`pnpm hash-password`). |
| `APP_PASSWORD_HASH_B64` | yes* | The same hash, base64-encoded (also printed by `pnpm hash-password`), for a host that mangles `$` in environment variables. Wins over `APP_PASSWORD_HASH`. |
| `SNAPSHOT_TOKEN` | yes | Bearer token the cron uses, 32 characters or more. |
| `ETH_RPC_URL` | no | Comma-separated JSON-RPC URLs for Ethereum. Replaces the public defaults. |
| `BASE_RPC_URL` | no | Same, for Base. |
| `BSC_RPC_URL` | no | Same, for BNB Chain. |
| `COINGECKO_API_KEY` | no | Raises the CoinGecko rate limit. |
| `EXCHANGE_KEY_SECRET` | for exchanges | 32 characters or more (`openssl rand -hex 32`). Encrypts the exchange API keys stored in the database. **Keep it**: if it changes or is lost, saved keys can no longer be read and must be entered again. |
| `PORT` | no | Server port, default `3001`. Passenger sets its own. |

`NODE_ENV` does not need to be set in production: `server/server.js` forces it. In production the session cookie is `Secure`, so the site **must** be served over HTTPS, otherwise login appears to work but the session is never kept.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Server and client in watch mode |
| `pnpm dev:db` / `pnpm dev:db:down` | Start / stop the local PostgreSQL |
| `pnpm db:migrate` | Apply the migrations locally |
| `pnpm test` | Server tests. They create and migrate their own `wealthmanager_test` database on the `DATABASE_URL` server. |
| `pnpm lint` | Lint the server |
| `pnpm build` | Build server and client |
| `pnpm snapshot:run` | Record today's snapshot now |
| `pnpm hash-password` | Print a bcrypt hash for `APP_PASSWORD_HASH` |

## Deploying on o2switch (Phusion Passenger)

CI builds everything, so nothing is compiled on the server. This follows the same layout as the author's other o2switch apps.

### 1. Create the database

In cPanel, **Bases de données PostgreSQL**: create a database and a user, give the user all privileges, and note the connection string:

```text
postgresql://<cpaneluser>_wmuser:<password>@localhost:5432/<cpaneluser>_wealth
```

### 2. Create the subdomain with HTTPS

In cPanel, create a subdomain (for example `wealth.<yourdomain>`) and run **AutoSSL** in **SSL/TLS Status**.

### 3. Get the artifacts

Every push to `main` (or a manual run of **Build & Package Deployment Artifacts** under the **Actions** tab) produces `server-artifact.zip` and `client-artifact.zip`. Download both from the run page.

### 4. Upload and extract

Create `/home/<cpaneluser>/wealth/` and extract **both** zips into it. Each holds its own top-level folder:

```text
/home/<cpaneluser>/wealth/
├── server/       server.js, package.json, dist/ (with dist/migrations/), node_modules/
└── client/
    └── dist/     index.html, assets/
```

The server looks for the front end at `../../client/dist` relative to `server/dist/`. If `/` shows `{"error":"Not found"}`, that folder is in the wrong place.

### 5. Configure the Node.js app

In cPanel, **Configurer une application Node.js**, then **Create Application**:

- Node.js version: `20.x`
- Mode: `Production`
- Application root: `wealth/server`
- Application URL: your subdomain
- Startup file: `server.js`

Add the environment variables `DATABASE_URL`, `APP_PASSWORD` and `SNAPSHOT_TOKEN` (plus the optional ones you want). There is no `.env` file in production, so variables come from this screen. Save, then restart the application after any change.

Prefer `APP_PASSWORD` over a bcrypt hash here: a hash contains `$` characters, and cPanel can pass the value through a shell that strips `$2b` and `$12`, leaving an invalid hash even though you pasted a valid one. If you do want a hash, use `APP_PASSWORD_HASH_B64` (printed by `pnpm hash-password`), which has no special characters. Remove any old `APP_PASSWORD_HASH` entry.

### 6. Run the migrations

On the same screen, click **Run JS script** and choose `migrate:prod`. Run it again after every deployment that adds a migration. Do not click **Run NPM Install**: `node_modules/` is already in the artifact.

`migrate:prod` starts `node-pg-migrate` through `node`, because the artifact zip loses file permissions and `node_modules/.bin/node-pg-migrate` would fail with "permission denied". It also passes `--disable-wasm-trap-handler`: o2switch caps each process's address space at 4 GB, and without the flag Node 20 fails with `RangeError: WebAssembly.instantiate(): Out of memory` as soon as it loads its built-in HTTP client.

The running app can hit the same limit on its first outbound request (a price or balance lookup). Add this environment variable to the Node.js app as well (Node 20.15 or later):

```text
NODE_OPTIONS=--disable-wasm-trap-handler
```

### If the site shows a generic error page

Passenger hides the app's output, so `server.js` writes its own log to `wealth/server/logs/app.log` (override with a `LOG_FILE` variable). Open it in cPanel's File Manager. The first line says which Node version is running and which of `DATABASE_URL`, `APP_PASSWORD`, `APP_PASSWORD_HASH` and `SNAPSHOT_TOKEN` are set, and the lines after it give the exact reason the app stopped, for example a missing variable, an invalid bcrypt hash, or `database connection FAILED`. If the file does not exist at all, Passenger never ran `server.js`: check the application root (`wealth/server`) and the startup file (`server.js`) in **Configurer une application Node.js**. The file is rotated at 5 MB and is never served to visitors.

### 7. Schedule the daily snapshot

In cPanel, **Tâches Cron**, add one job per day. Snapshots are keyed by UTC date, so pick a time that is unambiguous in your server's timezone (shortly after midnight UTC works well):

```bash
curl -fsS -X POST -H "Authorization: Bearer <SNAPSHOT_TOKEN>" https://wealth.<yourdomain>/api/snapshots/run
```

Put your address in the cron email field. `curl -f` makes a failed run (wrong token, no USD/EUR rate) exit non-zero, so cPanel mails you.

A run in which some providers fail still succeeds: the affected holdings are carried forward and shown as stale. Running it twice on the same UTC day updates that day's snapshot instead of adding another.

### Backups

Your history only exists in this database, so back it up. A daily `pg_dump` from a cPanel cron job is enough:

```bash
pg_dump "postgresql://<user>:<password>@localhost:5432/<db>" | gzip > ~/backups/wealth-$(date +\%F).sql.gz
```

The connection string is written out because a cron job does not see the Node.js app's variables. Keep it out of any shared file.

Copy the dumps off the server (rclone to a cloud drive works well) and delete old ones. The database holds addresses and balances but no keys or secrets.

## Install on Android

The app is an installable PWA, so it needs no app store.

1. Deploy it behind **HTTPS** (Android only offers installation on a secure origin).
2. Open the site in Chrome on the phone and log in.
3. Menu (three dots), then **Install app** (or **Add to Home screen**).

It then opens full screen with its own icon. Only the app shell is cached for offline start: balances and history always come from the server, and nothing financial is stored in the service worker cache.

The logo lives in `client/public/favicon.svg`. To change it, edit that file and run `pnpm --filter client generate-icons` to regenerate the PNG icons.

## Security notes

- The app only ever reads public addresses and balances. It never asks for a private key or seed phrase, and neither should you give it one.
- Login is rate-limited, sessions are stored as SHA-256 hashes, and the cookie is `HttpOnly`, `SameSite=Lax` and `Secure` in production.
- The snapshot endpoint accepts only the bearer token. A logged-in session cannot trigger it.
- Anyone who reads the database sees your addresses and balances. Treat backups accordingly.

## Project layout

```text
server/src/sources/   SourceType plug-ins (crypto today)
server/src/routes/    HTTP routes (auth, admin, dashboard, snapshots)
server/migrations/    node-pg-migrate migrations
client/src/           React app
docs/providers.md     what each data provider can and cannot do
SPEC.md               the specification this was built from
```

## License

[MIT](LICENSE)
