# 01 — Current-state assessment

**Status:** Draft (audited 2026-07-04, backend-focused)
**Purpose:** honest inventory of what exists today, so every other document can say
"gap" and point here. This is the baseline — re-audit after major changes.

## What the system is today

A three-part app (Hono/Bun backend, SvelteKit frontend, Expo Android app) built for
**single-household self-hosting** behind Tailscale. Docker/Podman Compose, Postgres 16,
Better Auth email+password. Roughly 20 API resource routes, comprehensive co-located
tests run in CI against real Postgres.

The design assumption baked in everywhere: **the network is trusted and the operator is
the user.** Public launch inverts both assumptions.

## Data inventory (what we'd be protecting)

From `backend/src/db/schema.ts`:

| Data | Tables | Sensitivity |
|------|--------|-------------|
| Email, name, password hash | `user`, `account` | PII + credential. Better Auth hashes with scrypt (good) |
| Session tokens, **IP address, user agent** | `session` | PII (IP is personal data under GDPR/PIPEDA) |
| Full financial ledger: amounts, currencies, dates, account paths | `postings`, `transactions`, `accounts` | The crown jewels. Reveals income, net worth, location history (merchants/currencies), spending patterns |
| Transaction descriptions | `transactions.description` | Free text from bank CSVs — merchant names, sometimes reference numbers. **Could contain stray sensitive strings the bank includes** |
| Shared-expense graph (who owes whom, group membership) | `expense_groups`, `group_*` | Relationship/financial PII, multi-user |
| Invitee emails (possibly of non-users) | `expense_group_invites` | PII of people who never consented to an account |
| CSV parser configs | `csv_parsers` | Low, but reveals which banks a user uses |
| FX rates | `fx_rates` | Public data, no concern |

**Notably absent:** card numbers (PANs), bank credentials, SSNs/SINs, government IDs.
The "no bank connections" principle means we never hold credentials to move money.
This is the single biggest scope-limiter for compliance (doc 03).

## Security posture — findings

### Authentication & sessions (`backend/src/auth.ts`)

- ✅ Better Auth with scrypt password hashing and origin-based CSRF checking
  (`trustedOrigins`).
- ✅ Session-guard middleware on all `/api/*` except `/api/auth/**` (`app.ts:43-49`);
  routes read `userId` from context — a sound tenancy pattern.
- ❌ **No email verification** (`emailVerified` column exists, nothing sets it) — anyone
  can sign up with someone else's email.
- ❌ **No password reset** — there is no email transport at all. A public user who
  forgets their password is locked out permanently.
- ❌ **No 2FA**, no session revocation UI, no login notification.
- ❌ `deleteUser` enabled with no verification step — Better Auth mitigates with a fresh
  session requirement, but confirm the flow before public use.
- ⚠️ Better Auth's built-in rate limiter only protects `/api/auth/*` endpoints, is
  enabled in production mode, and defaults to **in-memory storage** — resets on
  restart and breaks under multiple instances.
- ⚠️ Open registration: nothing stops mass signup (spam, storage abuse).

### API layer (`backend/src/app.ts`)

- ❌ **No rate limiting on any app route** (imports, reports, invites are all
  unthrottled).
- ❌ **No security headers** — `hono/secure-headers` is not used (no HSTS, no
  X-Content-Type-Options, no frame protection).
- ❌ No request body size limits visible — CSV import is an unbounded upload path.
- ❌ No structured/audit logging — `hono/logger` prints method+path+status to stdout.
- ⚠️ Per-route `userId` scoping needs a systematic IDOR audit (every query must filter
  by `userId` or verified group membership). Tests are good but were written for
  correctness, not adversarial access. **Not yet audited route-by-route.**
- ✅ CORS locked to a single origin with credentials.

### Database & data handling

- ❌ DB connection string carries no TLS requirement; single DB role owns everything
  (app runs with the same role that owns the schema and runs migrations).
- ❌ `docker-compose.yml` **publishes Postgres on host port 8886** — fine on a tailnet,
  an open door on a public host.
- ❌ No encryption at rest beyond whatever the host disk provides.
- ❌ **No backups at all** — one Docker volume, no dumps, no offsite copy, no tested
  restore. The most severe reliability gap.
- ⚠️ Soft deletes everywhere mean user data is retained indefinitely; user *deletion*
  cascades hard via FK (`onDelete: 'cascade'`), which is actually good for
  right-to-erasure — but group data referencing the deleted user cascades too, which
  can silently rewrite other members' history. Needs a design pass (doc 03).
- ⚠️ Amounts as `numeric(12,2)` strings — sound; caps a single posting at
  9,999,999,999.99, fine.

### Infrastructure & CI

- ❌ Containers run as **root** (both `oven/bun` and the frontend image; no `USER`
  directive), no resource limits, no read-only filesystems.
- ❌ Backend container runs `db:migrate` on every start — a race when >1 replica, and
  couples deploy to migration success.
- ❌ No TLS termination in the stack — assumed to be Tailscale's job today.
- ❌ CI runs tests only: **no dependency audit, no SAST, no secret scanning, no
  container image scanning**. Images pushed to GHCR as `:latest`.
- ❌ Secrets are plain env vars from `.env`; no rotation story. `SEED_EMAIL`/
  `SEED_PASSWORD` pattern in `.env.example` invites credentials in dotfiles.
- ⚠️ External runtime dependency: FX rates fetched from `frankfurter.app` — no SLA;
  needs graceful degradation and caching review at public scale.

### Frontend & mobile (shallow pass — deepen in a later session)

- Frontend: SvelteKit node adapter, server-side proxy to backend via
  `INTERNAL_API_URL`. Not audited for XSS-prone rendering of imported CSV text
  (descriptions are attacker-influenceable via crafted CSVs). Svelte escapes by
  default; audit any `{@html}` usage.
- Mobile: session token in Expo SecureStore (good); user-configurable server URL means
  the app can be pointed at malicious hosts — acceptable, but relevant if we ship a
  hosted service default.

## What's already strong

Worth saying explicitly — the foundation is better than most hobby projects:

- Test-first culture with real-DB integration tests and an isolated test database.
- Clean tenancy pattern (middleware-injected `userId`).
- Modern, maintained auth library rather than hand-rolled crypto.
- Soft-delete discipline and UTC timestamps.
- Migration discipline via Drizzle with generated SQL checked in.
- Data portability principle (hledger export) aligns with privacy-law portability
  requirements out of the box.

## Top 10 gaps, ranked (my recommendation)

1. **Backups + tested restore** — data loss is unrecoverable; everything else is not.
2. **Password reset + email verification** (requires an email provider) — table stakes.
3. **Rate limiting** on auth (persistent store) and app routes.
4. **IDOR audit** of every route's tenancy filtering + adversarial tests.
5. **TLS + security headers + hide Postgres port** — public network posture.
6. **Secrets management** and least-privilege DB roles.
7. **CI security gates** — dependency audit, secret scanning, image scan.
8. **Structured logging with PII redaction + audit trail** for auth events.
9. **Container hardening** — non-root, resource limits, pinned image digests.
10. **2FA (TOTP)** — expected for a finance app, cheap via Better Auth plugin.

Items 1–5 block any public exposure. Items 6–10 block *charging money* for it.

## Sources

- [Better Auth — Security reference](https://better-auth.com/docs/reference/security) (scrypt, origin checking)
- [Better Auth — Rate limit concepts](https://better-auth.com/docs/concepts/rate-limit) (defaults, in-memory storage, per-path rules)
- [Better Auth — 2FA plugin](https://better-auth.com/docs/plugins/2fa)
- Codebase: `backend/src/app.ts`, `backend/src/auth.ts`, `backend/src/db/schema.ts`,
  `docker-compose.yml`, `backend/Dockerfile`, `.github/workflows/ci.yml` @ commit on
  branch date 2026-07-04.
