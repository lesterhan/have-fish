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

## Conventions for future sessions

- Small, focused edits; one doc (or one section) per sitting is fine.
- Every factual claim that isn't from our own codebase gets a source link.
- When a doc's recommendations are accepted, extract phased work into
  `planning/epics/` and mark the doc `Stable`.
- Update the "Status at a glance" table and append a session-log entry before stopping.
