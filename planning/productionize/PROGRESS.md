# Productionization research — progress tracker

**Purpose:** this file is the hand-off between sessions. Read it at the start of every
session working on `planning/productionize/`; update it before ending the session.
Keep entries short — details belong in the numbered documents.

## Status at a glance

Direction decided 2026-09-11 — see [`00-direction.md`](00-direction.md). The cloud track
(`01`–`08`) is no longer a parallel product direction; it is research for the **sync
relay**, which holds identity and ciphertext but never ledgers.

| Doc | Status | Next action |
|-----|--------|-------------|
| 00 direction | **Living — the decision record** | Update whenever a decision lands; keep "Still open" honest |
| 01 current-state | Draft — **fully valid**; **moved to `have-fish-ops`** | Re-audit before any public exposure; frontend/mobile depth still missing |
| 02 data-security | Draft — **moved to `have-fish-ops`**; §3 and §7 apply unchanged | Re-read with a relay lens; Q2 is now answered by D6 |
| 03 compliance | Draft — obligations shrink to relay accounts + invitee emails | Decide Q1 (jurisdictions); draft retention numbers for relay data only |
| 04 auth-hardening | Outline — applies to **relay accounts only** | Write after the relay exists in design; the local app has no login |
| 05 subscriptions-billing | Draft — applies **almost verbatim** to the relay | Decide Q3 (Stripe vs MoR); price the sync tier |
| 06 infrastructure | Outline — relay-scoped and much smaller than written | Write alongside the relay design |
| 07 observability | Outline | Add an app-telemetry policy section (L05 §6: none, or opt-in crash only) |
| 08 launch-readiness | Outline | Decide Q5 (business entity); ToS/privacy sourcing |

### Local-first design documents

| Doc | Status | Next action |
|-----|--------|-------------|
| L01 architecture-packaging | Draft — **form factor decided (D7)** | Run the P1 kill-or-commit spike: compiled binary + embedded assets + SQLite |
| L02 data-layer | Draft — **SQLite decided (D8)** | Phase D2: schema translation, decimal helper, raw-SQL sweep, dual-dialect CI |
| L03 fish-pie-sync | Draft — F1 for v1 (D9); F3 relay is the target | Paper design spike: event-log schema + settlement state machine; answer LQ1 |
| L04 fx-offline | Draft — no open questions | Ready to become an epic whenever |
| L05 distribution-updates | Outline | Write full doc: signing pipeline, update mechanism, website |
| L06 monetization-licensing | Outline — **model decided (D1)** | Price research; resolve the MIT/public question that D1 assumes |
| L07 security-local | Outline | Write full doc; the localhost/DNS-rebinding section is the priority |
| L08 mobile-local | Outline — **unblocked by D5** | Write it: O1 offline queue for v1, O2 as the paid-sync flagship |
| — Track decision memo | **Not needed** | Superseded by 00-direction D1 |

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

### 2026-09-11 — Session 2 (direction settled)

**Done:**
- Restored this whole directory onto `main`. It had been sitting unmerged on
  `claude/productionize-security-planning-yo4s82` since 2026-07-04 and was nearly lost.
- Wrote [`00-direction.md`](00-direction.md) as the decision record and rewrote
  `README.md` around it. Folded in a separate `planning/exploration/data-ownership.md`
  draft that had started re-deriving L01/L02/L03 from scratch — one source of truth now.

**Decisions (detail in 00-direction):**
- **D1** Free local app + paid sync. Resolves LQ4 — local-first wins outright; the cloud
  track survives only as relay research. Rejected the flat-fee-app + subscription-multiplayer
  alternative: MIT source makes a licence key an honesty-toll, and it charges for the part
  with no marginal cost while giving away the part that has one.
- **D2** The single-player / multiplayer boundary, as the principle *the ledger is always
  writable; agreements with other people need the service*.
- **D3** Three connection states; "never linked" hides Fish Pie entirely rather than
  greying it out.
- **D4** Sync is automatic-when-reachable and non-blocking, not a button.
- **D5** The relay carries personal multi-device sync too. Resolves LQ3 (was "leaning yes").
- **D6** Plaintext locally, E2E-encrypted on the relay. Resolves Q2. Reverses an earlier
  judgement that E2EE was unnecessary — that was scoped to a personal tailnet deployment.
- **D7/D8/D9/D10** Confirm L01's binary, L02's SQLite, L03's F1-for-v1, and fix export
  scope with the export format doubling as the sync payload.

**New findings against the current codebase (2026-09-11):**
- The route partition is 10 personal / 8 Fish Pie / 1 hybrid (`fx-rates`) — the boundary
  in D2 follows a real joint.
- The write path is **completely FX-free**; only `routes/fx-rates.ts` and `routes/reports.ts`
  read `fxRates`, and the sole outbound `fetch()` in the backend is frankfurter. The
  `equity:conversion` design is why.
- ~1,420 LOC of domain logic, including the entire CSV import pipeline, already touches no
  database.
- `frontend/src/hooks.server.ts` calls `/api/auth/get-session` on **every page render** — a
  round trip before any UI, and a blank screen offline. It is also the only server-side code
  in the frontend, so `adapter-static` removes it cleanly.
- `updatedAt` exists on only two app tables; LWW merge needs it on all replicated ones.
- Import leaks into Fish Pie in three places; resolution recorded in D2.

**Unchanged and still urgent:** `01`'s top gaps. No backups of any kind, and no password
reset or email transport. Both outrank the entire direction above.

## Open questions for the owner

Resolved since kickoff: **Q2** (encryption → D6), **Q4** (hosting → moot; there is no
ledger-hosting service), **LQ3** (personal sync on the relay → D5), **LQ4** (track choice
→ D1).

- **NEW — does the repository stay MIT and public?** D1 assumes yes. Selling the binary
  would require changing that first, which is a bigger decision than pricing.
- **NEW — on linking to the relay, does it adopt the locally-generated `userId`?**
  `userId` is `text` and threaded through every table, so a local install can mint a UUID
  at first run and have the relay adopt it. The fallback — rewriting `userId` across every
  local row on link — is a data migration on a finance app. Check how hard Better Auth
  resists before committing.
- **Q1 (doc 03):** Target jurisdictions? Canada/US-first vs accepting EU users changes the
  relay's privacy obligations. Smaller than it was, since the relay holds no ledgers.
- **Q3 (doc 05):** Stripe direct vs merchant of record (Paddle/Lemon Squeezy) for the sync
  subscription.
- **Q5 (doc 08):** Sole proprietor or incorporate? Still matters — the relay holds
  identity, and we ship executables.
- **LQ1 (L03):** Is multi-currency settlement math order-independent under the event-log
  design? Needs the paper spike; the existing fish-pie tests are the conformance corpus.
- **LQ2 (L02):** Optional passphrase encryption of the local SQLite file. Deferred by D6,
  not rejected.
- **Mobile (L08):** LAN companion with an offline queue (O1) for v1, or go straight to a
  true local peer (O2)? D5 unblocks O2 but does not schedule it.

## Conventions for future sessions

- Small, focused edits; one doc (or one section) per sitting is fine.
- Every factual claim that isn't from our own codebase gets a source link.
- When a doc's recommendations are accepted, extract phased work into
  `planning/epics/` and mark the doc `Stable`.
- Update the "Status at a glance" table and append a session-log entry before stopping.
