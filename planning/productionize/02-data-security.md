# 02 — Data security

**Status:** Draft (first full pass 2026-07-04)
**Scope:** protecting user financial data and PII in a public deployment. Compliance
framing (PCI, privacy law) lives in doc 03; auth mechanics in doc 04; infra in doc 06.
This doc is the *what and why*; those docs carry the adjacent detail.

## Threat model

Who attacks a small public finance tracker, and what do they want?

| Adversary | Goal | Realistic vectors |
|-----------|------|-------------------|
| Opportunistic scanners/bots | Any foothold; credential stuffing lists | Exposed ports, default creds, unpatched CVEs, auth endpoints without rate limits |
| Credential stuffers | Account takeover → financial profile for phishing/fraud | Reused passwords from other breaches (**most likely successful attack**) |
| Malicious *user* | Other tenants' data; free compute/storage | IDOR across `userId`/group boundaries, unbounded uploads, abuse of invites for spam |
| Malicious *input* | XSS/injection via data paths | Crafted bank CSVs (descriptions render in UI; exports open in Excel) |
| Server compromise | Whole database | Any RCE, stolen backup, leaked `.env` |
| Us (accidental) | — | Bad migration, logging PII, un-tested restore, pushed secret |

Design consequence: **assume single-server compromise is possible and make the blast
radius survivable** (encrypted backups offsite, no secrets in the repo, breach-response
plan — doc 03), and **assume any authenticated user is hostile to other tenants**.

## 1. Data in transit

- **TLS everywhere, terminated by a reverse proxy** (Caddy is the low-ops choice:
  automatic Let's Encrypt, sane defaults; Traefik/nginx fine too). The Bun backend
  should never face the internet directly.
- **HSTS** (`Strict-Transport-Security`, then preload once stable) plus the standard
  header set via `hono/secure-headers`: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, restrictive `Permissions-Policy`, CSP on the frontend.
- **Backend ⇄ Postgres over TLS or a private network only.** Remove the
  `ports: 8886:5432` publication from the production compose file; if DB is remote
  (managed Postgres), require `sslmode=verify-full` in `DATABASE_URL`.
- Mobile app: enforce HTTPS-only server URLs when pointing at the hosted service
  (allow HTTP only behind a developer flag for self-hosters on tailnets).
- Cookies: `Secure`, `HttpOnly`, `SameSite=Lax` (Better Auth defaults are close;
  verify `useSecureCookies` is on in production).

## 2. Data at rest

Layered, cheapest-first:

1. **Full-disk/volume encryption** on the host (LUKS, or the provider's encrypted
   volumes). Non-negotiable, nearly free.
2. **Encrypted backups** (see §5) — backups are the most commonly stolen copy of a
   database.
3. **Field-level (application-layer) encryption** of `transactions.description`,
   `accounts.path`/`name`, and group expense descriptions — the free-text fields that
   reveal the most. **Recommendation: defer for v1** (open question Q2 in PROGRESS.md).
   Why: it breaks server-side search/`ILIKE` (import-rule matching mines
   descriptions), complicates the hledger export path, and adds a key-management
   problem, while the realistic threats (stuffing, IDOR) aren't mitigated by it.
   Revisit once there's revenue; if adopted, use per-user data keys wrapped by a
   master key (envelope encryption) so key rotation doesn't rewrite the table.
4. **Amounts stay plaintext** regardless — every report/aggregation depends on SQL
   `SUM`s; encrypting them means rewriting the reporting layer or homomorphic
   gymnastics that aren't warranted at this scale.

## 3. Application-layer defenses

### Multi-tenancy (the #1 code-level risk)

- **Systematic IDOR audit**: every query in `backend/src/routes/**` and the fish-pie
  services must filter by `c.get('userId')` or verified group membership. One-time
  audit + a written checklist for new routes.
- **Adversarial test convention**: for every route, a co-located test where user B
  requests user A's resource ID and must get 404/403. Make this as habitual as
  `clearDatabase()`.
- Consider **Postgres Row-Level Security** as defense-in-depth: policies on
  `userId`-bearing tables keyed to a per-request `SET LOCAL app.user_id`. Real work
  with Drizzle + the fish-pie shared tables, so schedule it as a hardening phase, not
  a launch blocker — the middleware pattern is sound if consistently applied.

### Input handling

- **CSV import is the main untrusted-input pipe.**
  - Enforce upload size limits (Hono `bodyLimit` middleware) and row-count caps.
  - Parse with hardened settings; never eval; treat every cell as text (already the
    case — amounts parsed to numeric strings).
  - **CSV/formula injection on the way *out***: hledger journal export and any future
    CSV export must escape cells starting with `= + - @ \t` so Excel doesn't execute
    them ([OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)).
  - XSS via descriptions: Svelte auto-escapes; audit for `{@html}` and keep it out of
    any path rendering imported text. Add a CSP as backstop.
- **Validation at the boundary**: adopt zod (or Hono's validator) schemas per route so
  malformed input is rejected before touching the DB. Today validation is ad-hoc.
- SQL injection: Drizzle parameterizes; keep raw `sql` fragments reviewed and never
  interpolate user input into them.

### Rate limiting & abuse (detail in doc 04)

- Auth endpoints: Better Auth's limiter with a **persistent store** (Redis or the DB)
  instead of default in-memory.
- App endpoints: per-user and per-IP limits on writes, imports, invite sending
  (invites are an email-spam vector: cap per user per day).
- Signup friction: email verification (doc 04) + optional CAPTCHA/proof-of-work if
  bot signups appear.

## 4. Secrets management

- Never in git (`.env` is already gitignored — verify; add secret scanning to CI to
  enforce: [gitleaks](https://github.com/gitleaks/gitleaks) action + GitHub push
  protection).
- Production: Docker/Podman **secrets** or SOPS-encrypted env files (age key held
  offline) rather than plain `.env` on the host. A dedicated secrets manager is
  overkill at this size; SOPS + a documented rotation runbook is the sweet spot.
- **Rotation runbook** for `BETTER_AUTH_SECRET` (invalidates sessions — document
  that), DB password, SMTP/Stripe keys. Write it before you need it.
- Split DB roles: a migration role (DDL) and a runtime app role (DML only, no
  `DROP`/`ALTER`). Cheap insurance against SQLi escalation and bad app bugs.

## 5. Backups (security half — ops half in doc 06)

- `pg_dump` (or WAL-G/pgBackRest when we want point-in-time recovery) on a schedule,
  **encrypted client-side** (age/GPG) before leaving the host, shipped **offsite**
  (B2/S3 with versioning + object lock), retention ~30 daily / 12 monthly.
- **Restore is tested monthly** — an untested backup is a hope, not a backup. Automate
  a restore-into-scratch-DB job that runs a row-count sanity check.
- Backups contain everything the DB does → they inherit the breach-notification
  obligations in doc 03. Access to the backup bucket is its own credential to protect.

## 6. Logging & data leakage

- Replace `hono/logger` with structured JSON logging with an explicit **redaction
  list**: never log request bodies, `Authorization`/cookie headers, emails (or hash
  them), or query strings that may embed tokens.
- **Audit log** (append-only table or log stream) for security events: signup, login
  success/failure, password change, email change, session revocation, export,
  account deletion, group invite. This is both forensics and PIPEDA breach-assessment
  evidence (doc 03).
- Log retention with a cap (e.g. 90 days app logs, 1–2 years audit log) — logs with
  IPs are PII too.
- Error responses: never leak stack traces or SQL to clients; generic 500 body,
  detail to logs only.

## 7. Supply chain & platform

- CI gates: `bun audit` (or osv-scanner) for dependency CVEs, gitleaks for secrets,
  Trivy for image scanning, Dependabot/Renovate for updates. Pin GH Actions by SHA.
- Pin base images by digest; rebuild on a schedule to pick up OS patches (an image
  built once and run for a year quietly accumulates CVEs).
- Containers: `USER bun` (non-root), `read_only: true` where possible, resource
  limits, `no-new-privileges`.
- Subscribe to Better Auth / Hono / Drizzle security advisories (GitHub watch →
  security alerts).

## 8. Standards to measure against

Use **[OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
Level 2** as the checklist for a finance app (L1 is too shallow for financial data;
L3 is overkill). A one-time self-assessment against ASVS 5.0 chapters (auth, session,
access control, validation, stored data) will generate the concrete backlog; check
results into this directory. The [OWASP Top 10 (2021)](https://owasp.org/Top10/)
mapping for us: A01 Broken Access Control → §3 tenancy; A02 Crypto Failures → §1–2;
A05 Misconfig → §7 and doc 06; A07 Auth Failures → doc 04.

## Phased work breakdown

**Phase S1 — before any public exposure** (≈2–4 weeks of focused work)
TLS + reverse proxy + security headers; remove published DB port; Better Auth
persistent rate limiting; body-size limits; encrypted offsite backups + one tested
restore; secret scanning in CI; IDOR audit + adversarial tests.

**Phase S2 — before charging money** (≈3–5 weeks)
Structured logging + redaction + audit log; DB role split; SOPS secrets + rotation
runbook; dependency/image scanning gates; container hardening; CSV-injection-safe
export; validation schemas on all routes; ASVS L2 self-assessment.

**Phase S3 — maturity** (ongoing)
Postgres RLS; field-level encryption decision (Q2); anomaly alerting on audit log;
periodic third-party pentest or at least an automated DAST pass (OWASP ZAP baseline
scan in CI).

## Sources

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) — verification checklist, use L2
- [OWASP Top 10 (2021)](https://owasp.org/Top10/)
- [OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) — esp. Password Storage, Logging, Database Security
- [Better Auth — Security reference](https://better-auth.com/docs/reference/security)
- [Better Auth — Rate limit](https://better-auth.com/docs/concepts/rate-limit)
- [Hono — Secure Headers middleware](https://hono.dev/docs/middleware/builtin/secure-headers), [Body Limit middleware](https://hono.dev/docs/middleware/builtin/body-limit)
- [PostgreSQL — Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [SSL Support](https://www.postgresql.org/docs/current/libpq-ssl.html)
- [SOPS](https://github.com/getsops/sops), [gitleaks](https://github.com/gitleaks/gitleaks), [Trivy](https://github.com/aquasecurity/trivy), [pgBackRest](https://pgbackrest.org/)
