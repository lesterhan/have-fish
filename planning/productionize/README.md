# Productionize have-fish

Research and planning for taking have-fish from a self-hosted personal tool to a product
other people can install and use.

**Start with [`00-direction.md`](00-direction.md).** It is the decision record — what we
are building, why, and which of the open choices below have since been settled. Everything
else in this directory is research that feeds it.

## Direction, in one line

A free local-first application where your ledger is a file on your machine, plus an
optional paid sync service that relays end-to-end-encrypted changes between your devices
and, for Fish Pie, between people. Decided 2026-09-11 — see `00-direction.md` D1.

The original two-track framing (cloud SaaS versus local-first, decide later) is resolved
in favour of local-first. The cloud research survives re-scoped to the **sync relay**,
which is a miniature version of the service the cloud track imagined: it holds identity
and ciphertext, never ledgers.

## How to use this directory

- **[`00-direction.md`](00-direction.md)** — decisions. Read first, and where it conflicts
  with an older document, it wins.
- **[`PROGRESS.md`](PROGRESS.md)** — cross-session tracker. Read at the start of a working
  session, update before stopping.
- The numbered and `L`-prefixed documents are **research**, dated 2026-07-04. They remain
  accurate as research. Treat `Outline` status as a queue, not as finished guidance.
- Sources are cited inline so claims can be verified.

## Document index

| # | Document | Topic | Status |
|---|----------|-------|--------|
| 00 | [direction.md](00-direction.md) | **Decisions — read first** | Living |
| — | [PROGRESS.md](PROGRESS.md) | Cross-session tracker | Living |
| 01 | _private repo_ | Audit of codebase & infra, 2026-07-04 | Draft — **fully valid**, held privately |
| 02 | _private repo_ | Protecting financial data & PII | Draft — held privately; §3, §7 apply unchanged |
| 03 | [compliance-pci-privacy.md](03-compliance-pci-privacy.md) | PCI DSS, PIPEDA/GDPR, retention | Draft — relay-scoped, much reduced |
| 04 | [auth-hardening.md](04-auth-hardening.md) | Verification, 2FA, rate limits, sessions | Outline — relay accounts only |
| 05 | [subscriptions-billing.md](05-subscriptions-billing.md) | Entitlements & billing | Draft — applies almost verbatim |
| 06 | [infrastructure-reliability.md](06-infrastructure-reliability.md) | Hosting, backups, DR, TLS | Outline — relay-scoped |
| 07 | [observability-operations.md](07-observability-operations.md) | Logging, monitoring, incident response | Outline — plus app telemetry policy |
| 08 | [launch-readiness.md](08-launch-readiness.md) | Legal, ToS, support, cost model | Outline |

### The local-first design documents

| # | Document | Status |
|---|----------|--------|
| L01 | [architecture-packaging.md](local-first/L01-architecture-packaging.md) — compiled Bun binary, Tauri later | Draft — **decided**, see D7 |
| L02 | [data-layer.md](local-first/L02-data-layer.md) — embedded database, user-owned file | Draft — **decided: SQLite**, see D8 |
| L03 | [fish-pie-sync.md](local-first/L03-fish-pie-sync.md) — multi-user without a database we own | Draft — largest work item |
| L04 | [fx-offline.md](local-first/L04-fx-offline.md) — FX without an always-on server | Draft — ready to become an epic |
| L05 | [distribution-updates.md](local-first/L05-distribution-updates.md) — installers, signing, updates | Outline |
| L06 | [monetization-licensing.md](local-first/L06-monetization-licensing.md) — pricing models | Outline — **decided: free app + paid sync**, see D1 |
| L07 | [security-local.md](local-first/L07-security-local.md) — the shifted threat model | Outline — localhost surface is the headline |
| L08 | [mobile-local.md](local-first/L08-mobile-local.md) — mobile without our cloud | Outline — unblocked by D5 |

There is also a [`local-first/README.md`](local-first/README.md) with the track's own
framing; it predates `00-direction.md` and is kept for its redesign inventory.

## The urgent part

The private audit (`01`) found that the deployment running today has **no backups of any kind** — one Docker
volume, no dumps, no offsite copy, no tested restore — and **no password reset or email
transport**, so a forgotten password is permanent lockout. Neither has anything to do with
the direction above, and both outrank all of it. See `00-direction.md` § "Do these now".

## Non-negotiable product constraints (from CLAUDE.md vision)

Every recommendation here respects:

- **No bank connections** — no OAuth to financial institutions, no third-party sync. This
  is also the biggest compliance advantage; see `03`.
- **Portable data** — hledger export is the escape hatch, and in this direction it gets
  stronger: the data file itself is user-owned. Production hardening must not trap data.
- **Multi-currency first-class** — see `L04` for how rates work without an always-on
  server.
