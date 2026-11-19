# Implementation Plan: wealth-manager

Spec: [../SPEC.md](../SPEC.md) (approved v2). Intent: [../docs/intent/portfolio.md](../docs/intent/portfolio.md).
Tasks are tracked in [todo.md](todo.md) (default target, no external tracker designated).

## Overview

A single-owner web app that takes one snapshot a day of BTC, ETH and Base holdings (native coins and chosen ERC-20 tokens) and charts the net worth in USD and EUR. The build order is: scaffold and auth, then a source-agnostic snapshot engine (proven with a fake source), then the crypto source as the first real plug-in, then the dashboard, then deploy and open-source packaging.

## Architecture Decisions

- **Engine before crypto.** The snapshot engine, FX, carry-forward and the token-guarded endpoint are built and tested with a fake `SourceType` first. Crypto then plugs in as a real source. This proves the extensibility contract (spec criterion 11) early and keeps the engine free of crypto knowledge.
- **Vertical slices where a UI exists.** Auth, crypto admin and dashboard each ship schema, API and UI as testable slices. The engine is the one deliberate horizontal layer, because it has no UI of its own.
- **Provider risk goes first.** A short spike verifies the BTC, Blockscout, CoinGecko and Frankfurter APIs against their current docs (free-tier limits, spam flags, token-by-contract pricing) before any adapter is written. If a provider doesn't fit, we find out in Task 3, not Task 10.
- **Fixtures, not live calls.** Adapter tests run on recorded JSON fixtures, using made-up addresses.
- **Money as strings.** `NUMERIC` in PostgreSQL, decimal strings across the API, and a decimal helper in `lib/money.ts`.
- **Carry-forward lives in the engine.** Every later source type inherits it.
- **No heavy deps.** No ORM, no WASM, no Socket.IO, no PWA. This matches the o2switch memory limits documented in meals-planner.

## Decisions I need confirmed (new dependencies, per "Ask first")

1. **Decimal math:** `decimal.js` (small, pure JS, no WASM) for price × amount and FX math. The alternative is hand-rolled BigInt helpers, which is more code and more risk. My default is `decimal.js`.
2. **Address validation without extra libraries:** Format checks only (EVM: `0x` plus 40 hex, lowercased and stored. BTC: regex for legacy, P2SH and bech32 shapes). The provider rejects anything that is not a real address. I'm skipping EIP-55 checksum and bech32 checksum validation to avoid adding `viem` or `bitcoinjs-lib`. The cost is that a typo is caught by the provider (a 400/404 on first fetch), not at input time. My default is format checks only.

## Dependency graph

```
T1 server scaffold ──┬── T2 client scaffold
                     ├── T3 provider spike (docs only, informs T9, T10, T11)
                     └── T4 auth API ── T5 login UI
T6 money+FX ── T7 snapshot schema+engine ── T8 snapshot endpoint
T8 ── T9 crypto addresses API ── T10 balances+prices adapters ── T11 crypto SourceType
T11 ── T12 token scan ── T13 tracked tokens + manual add
T9 ── T14 admin Crypto UI (addresses) ── T15 admin Crypto UI (tokens, needs T13)
T11 ── T16 dashboard API ── T17 dashboard UI
T2, T8 ── T18 prod serving + CI ── T19 README, deploy guide, OSS hygiene
```

Parallelizable after T1: T2, T3, T4 and T6 touch separate files. Everything else is sequential on the chain above.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A free provider is rate-limited or lacks a needed feature (token spam flag, price by contract on Base) | High | T3 spike before adapters. Adapters sit behind interfaces. A free key is already approved as a fallback. |
| CoinGecko has no price for some Base tokens | Med | Such tokens are flagged "unpriced" (spec #4, #5) and carry-forward handles transient misses. |
| Carry-forward logic is subtly wrong (double counting, stale never clearing) | High | Engine is built early (T7) with focused integration tests on a real PostgreSQL, including retry-same-day. |
| Passenger/o2switch quirks (memory caps, cookie `Secure`, env vars) | Med | Reuse the meals-planner `server.js`, layout and README steps. Deploy slice (T18, T19) is last but copies a proven setup. |
| Provider response data is hostile (token names, symbols) | Med | Escape in the UI, cap lengths on write, never render as HTML (spec Boundaries). |
| Cron fires twice or overlaps | Low | Snapshot upsert per UTC date (idempotent) plus a transaction. |

## Task List

See [todo.md](todo.md) for the full checklist with acceptance criteria and verification steps. Order:

### Phase 1: Foundation
T1 server scaffold, T2 client scaffold, T3 provider spike, T4 auth API, T5 login UI
Checkpoint A

### Phase 2: Snapshot engine
T6 money + FX, T7 snapshot schema + engine, T8 token-guarded endpoint
Checkpoint B

### Phase 3: Crypto source
T9 addresses API, T10 balance + price adapters, T11 crypto SourceType, T12 token scan, T13 tracked tokens, T14 admin UI (addresses), T15 admin UI (tokens)
Checkpoint C (first real snapshot end to end)

### Phase 4: Dashboard
T16 dashboard API, T17 dashboard UI
Checkpoint D

### Phase 5: Ship
T18 production serving + CI artifacts, T19 README, deploy guide, OSS hygiene
Checkpoint E (spec criteria 1 to 13 all met)

## Open Questions

- The two dependency decisions above (decimal.js, format-only address validation).
- Should I `git init` the repo now (locally, no remote) so each task can be committed? I won't push anything to GitHub until you say so.
