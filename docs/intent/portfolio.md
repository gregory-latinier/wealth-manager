# Portfolio tracker: statement of intent

Confirmed by the owner on 2026-11-19.

- **Outcome:** A web app that takes one snapshot a day of everything the owner holds and charts how their net worth evolves, in both USD and EUR.
- **User:** Only the owner, behind a single password with no user accounts. The repo is open source so others can self-host their own copy.
- **Why now:** One place to see how wealth evolves. Crypto comes first, and Aave, forex, bank accounts and stocks come later.
- **Success:**
  - The owner adds a BTC, ETH or Base address in the UI. For ETH and Base, the app scans it for tokens above a value threshold (default about $10, configurable), and the owner picks which to track. A token can also be added by contract address.
  - Spam and unpriced tokens are hidden or flagged.
  - An o2switch cron calls a token-protected snapshot endpoint once a day.
  - The chart shows the total plus a per-asset breakdown.
- **Constraint:**
  - Runs on o2switch with Node.js and PostgreSQL.
  - Stack follows meals-planner: pnpm monorepo, Fastify 5, TypeScript, `node-pg-migrate`, React 19 with Vite.
  - Prices come from free APIs.
  - Each asset type gets its own admin page, and later types plug in the same way.
- **Out of scope for v1:**
  - Backfilling past balances.
  - Trade history, taxes and P&L.
  - Multi-user accounts and 2FA.
  - Aave, forex, bank accounts and stocks.
  - Chains other than BTC, ETH and Base.
  - NFTs.

## Assumptions folded in without asking

- The snapshot endpoint uses its own secret token, separate from the login password.
- Price sources are free APIs chosen at implementation time (CoinGecko for crypto, a free FX source for USD/EUR).
