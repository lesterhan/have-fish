# Track B — Local-first distribution

The alternative to the cloud-hosted track (docs `01`–`08` in the parent directory):
**have-fish as a self-contained executable the user downloads and runs; all data lives
on the user's machine.** No server we operate holds ledgers.

Progress for this track is tracked in the shared [`../PROGRESS.md`](../PROGRESS.md).

## Why this direction is credible for this app

- The vision already leans local: no bank connections, manual/CSV entry, portable
  hledger export. There is no feature that *requires* our cloud.
- The proven precedent is **Actual Budget**: local-first budgeting, data on-device,
  CRDT-based sync through an optional server that only ever relays encrypted change
  messages. Obsidian's business model (free local app, paid sync subscription) shows
  local-first and recurring revenue are compatible.
- Most of the cloud track's hardest obligations shrink dramatically: no multi-tenant
  IDOR surface, no breach-notification exposure for ledger data we don't hold, no
  backup liability for user data (with a new duty: making *user-owned* backup easy).

## What has to be redesigned (the honest list)

| Area | Cloud assumption today | Local-first redesign | Doc |
|---|---|---|---|
| Packaging | Compose stack, 3 containers | Single executable per OS | L01 |
| Database | Postgres 16 server | Embedded DB (SQLite vs PGlite decision) | L02 |
| Auth | Better Auth multi-user email/password | No login for local use; identity only reappears for sync | L01/L03 |
| **Fish Pie** | Shared Postgres rows across users | The hard problem: sync/CRDT or a relay service | L03 |
| FX rates | Server fetches frankfurter.app | Offline-first cache + seed data + manual rates | L04 |
| Data portability | hledger export from server | Even stronger: the data file itself is user-owned | L02 |
| Distribution | We deploy; users visit a URL | Installers, code signing, auto-update channel | L05 |
| Monetization | Subscriptions (Stripe) | License keys / paid sync — different machinery | L06 |
| Security | Tenant isolation, server hardening | Update supply chain, localhost binding, local file safety | L07 |
| Mobile | Companion talks to our cloud | LAN companion vs true local mobile + sync | L08 |

## Document index

| # | Document | Status |
|---|----------|--------|
| L01 | [architecture-packaging.md](L01-architecture-packaging.md) — form factor: Bun binary vs Tauri vs Electron | Draft |
| L02 | [data-layer.md](L02-data-layer.md) — embedded database, schema migration, user-owned files | Draft |
| L03 | [fish-pie-sync.md](L03-fish-pie-sync.md) — multi-user features without a database we own | Draft |
| L04 | [fx-offline.md](L04-fx-offline.md) — FX rates without an always-on server | Draft |
| L05 | [distribution-updates.md](L05-distribution-updates.md) — installers, signing, auto-update | Outline |
| L06 | [monetization-licensing.md](L06-monetization-licensing.md) — one-time purchase, license keys, paid sync | Outline |
| L07 | [security-local.md](L07-security-local.md) — the shifted threat model | Outline |
| L08 | [mobile-local.md](L08-mobile-local.md) — mobile story without our cloud | Outline |

## Relationship to Track A (cloud)

These are not mutually exclusive — three end states are possible:

1. **Cloud only** (Track A as written).
2. **Local only** (this track; optional paid sync relay is the only service we run).
3. **Both**: local app + hosted offering sharing one codebase. This is the most work
   (dual DB dialects, dual auth modes) — L02 discusses the cost honestly.

A comparison decision memo (pick 1/2/3, with criteria: revenue model, ops burden,
compliance exposure, feature reach) should be written **after** L05/L06 are fleshed
out — queued in PROGRESS.md as the capstone of this track.
