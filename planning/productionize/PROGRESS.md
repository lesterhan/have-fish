# Productionization research — progress tracker

**Purpose:** this file is the hand-off between sessions. Read it at the start of every
session working on `planning/productionize/`; update it before ending the session.
Keep entries short — details belong in the numbered documents.

## Status at a glance

| Doc | Status | Next action |
|-----|--------|-------------|
| 01 current-state-assessment | Draft — full audit done 2026-07-04 | Re-verify after any auth/infra change; add frontend/mobile audit depth (only backend was audited closely) |
| 02 data-security | Draft — complete first pass | Review with owner; decide on field-level encryption question (open Q2); split phased work into epics |
| 03 compliance-pci-privacy | Draft — PCI answered, PIPEDA/GDPR first pass | Decide target jurisdictions (open Q1); draft data-retention policy numbers |
| 04 auth-hardening | Outline only | Write full doc: email provider choice, Better Auth config diff, migration plan for existing users |
| 05 subscriptions-billing | Draft — architecture + provider comparison done | Decide Stripe vs merchant-of-record (open Q3); price/tier design; mobile billing policy check |
| 06 infrastructure-reliability | Outline only | Write full doc: pick hosting target, design backup/restore + DR runbook, TLS story |
| 07 observability-operations | Outline only | Write full doc: logging redaction rules, metrics, alerting, incident response runbook |
| 08 launch-readiness | Outline only | Write full doc: ToS/privacy policy sourcing, support channel, cost model, abuse handling |

### Track B — local-first (`local-first/`)

| Doc | Status | Next action |
|-----|--------|-------------|
| L01 architecture-packaging | Draft | Run the P1 kill-or-commit spike (compiled binary + embedded assets + SQLite/PGlite) |
| L02 data-layer | Draft | Bake-off SQLite vs PGlite in the P1 spike; then decide (recommendation: SQLite) |
| L03 fish-pie-sync | Draft | Paper design spike: event-log schema + settlement state machine; answer LQ1/LQ3 |
| L04 fx-offline | Draft | Small; ready to become an epic whenever |
| L05 distribution-updates | Outline only | Write full doc: signing pipeline details, update mechanism, website |
| L06 monetization-licensing | Outline only | Write full doc after L03 spike (paid-sync is the leading model) |
| L07 security-local | Outline only | Write full doc: localhost/DNS-rebinding defenses are the priority section |
| L08 mobile-local | Outline only | Blocked on LQ3 (relay personal sync) — write after L03 spike |
| — Track decision memo | Not started | Capstone: A vs B vs both, after L05/L06 exist |

## Session log

### 2026-07-04 — Session 1 (kickoff)

**Done:**
- Audited backend: `app.ts`, `auth.ts`, `db/schema.ts`, `db/index.ts`, Dockerfiles,
  `docker-compose.yml`, `.env.example`, CI workflows. Findings in doc 01.
- Researched and wrote first-pass docs 01, 02, 03, 05. Outlined 04, 06, 07, 08.
- Answered the three kickoff questions (PCI DSS → doc 03; subscriptions → doc 05;
  other launch concerns → docs 04/06/07/08 outlines).

**Key findings (detail in doc 01):**
- Auth is email+password with **no email verification, no password reset, no 2FA, no
  email transport at all** — biggest functional gap for public launch (doc 04).
- **No rate limiting on app API routes**, no security headers, Postgres port published
  to the host, containers run as root, migrations run on container start.
- **No backups** of any kind. Single biggest reliability risk.
- PCI DSS: app stores **no cardholder data** today → out of scope. Adding Stripe
  Checkout (hosted redirect) keeps us at **SAQ A**, the lightest assessment (doc 03).
- Better Auth has an official **Stripe plugin** that models subscriptions on the auth
  layer — natural fit for entitlements (doc 05).

### 2026-07-04 — Session 1b (same day): Track B added

**Done:**
- Owner requested a parallel exploration: self-contained executable, all data local.
- Created `local-first/` with its own README + L01–L08. Drafts: L01 (form factor —
  recommend Bun compiled binary + browser now, Tauri wrap later), L02 (embedded DB —
  recommend SQLite over PGlite, schema translation costed), L03 (Fish Pie redesign —
  recommend v1 single-user, then E2E-encrypted sync relay à la Actual Budget; this
  is also the leading revenue model), L04 (offline FX — seed data + manual rates).
  Outlines: L05 (distribution/signing — real costs researched: ~US$320+/yr),
  L06 (monetization — free app + paid sync leads), L07 (security — localhost/DNS
  rebinding is the new headline risk), L08 (mobile — blocked on LQ3).

**Key insight:** Track B eliminates most of Track A's heaviest liabilities (tenant
isolation, ledger-breach exposure, backup custody) and replaces them with three new
ones: update supply chain, localhost attack surface, and the Fish Pie sync redesign —
which is the single biggest work item in either track (~2–3 months alone).

## Open questions for the owner

- **Q1 (doc 03):** Target market/jurisdictions? Canada-only launch vs. accepting EU
  users changes privacy obligations (PIPEDA only vs. + GDPR: DPO-ish contact, EU
  representative, data-transfer clauses).
- **Q2 (doc 02):** Field-level (application-layer) encryption of transaction
  descriptions/amounts — worth the complexity, or is full-disk + backup encryption
  enough for v1? Doc 02 recommends deferring, but it's a product-values call.
- **Q3 (doc 05):** Stripe direct (more control, you handle tax) vs. merchant of record
  like Paddle/Lemon Squeezy (they handle global sales tax/VAT, higher fees)?
- **Q4 (doc 06, when written):** Keep home-server hosting for launch, or move to a
  managed provider (Fly.io/Hetzner/DigitalOcean + managed Postgres)? Affects every doc.
- **Q5 (doc 08, when written):** Business entity — launch as sole proprietor or
  incorporate first? Liability shielding matters when holding others' financial data.

### Track B open questions

- **LQ1 (L03):** Is multi-currency settlement math order-independent under the
  event-log/CRDT design? Needs the paper spike; existing fish-pie tests are the
  conformance corpus.
- **LQ2 (L02):** Optional passphrase encryption of the local SQLite file — v1 says
  rely on OS disk encryption; revisit with `better-sqlite3-multiple-ciphers`.
- **LQ3 (L03/L08):** Does the sync relay also do *personal* multi-device sync (not
  just Fish Pie groups)? Leaning yes — it's the strongest paid-tier pitch and the
  unlock for true local mobile.
- **LQ4 (capstone):** Track A vs Track B vs both from one codebase? Both = permanent
  dual-dialect/dual-auth tax (L02/L01); decide after L05/L06 are written and Track A
  Q1/Q3/Q4 are answered.

## Conventions for future sessions

- Small, focused edits; one doc (or one section) per sitting is fine.
- Every factual claim that isn't from our own codebase gets a source link.
- When a doc's recommendations are accepted, extract phased work into
  `planning/epics/` and mark the doc `Stable`.
- Update the "Status at a glance" table and append a session-log entry before stopping.
