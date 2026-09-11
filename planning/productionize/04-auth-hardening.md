# 04 — Auth hardening

**Status:** Outline — key findings recorded; full doc is the next writing priority
(it blocks billing, doc 05 Phase B0).

## Why this is the top functional gap

Doc 01 findings: no email verification, **no password reset (no email transport at
all)**, no 2FA, rate limiting only on auth routes and only in-memory. A public user
who forgets their password today is permanently locked out. Everything below is
standard Better Auth configuration + one infrastructure choice (email provider).

## Sections to write (research queue)

1. **Email provider selection** — the one new infra dependency. Compare
   Postmark / Resend / Amazon SES / Mailgun on: transactional deliverability,
   price at low volume, template workflow, DMARC tooling. Needs: domain,
   SPF/DKIM/DMARC records, bounce handling. (Also unlocks Fish Pie invite emails —
   currently invites are in-app only.)
2. **Better Auth config diff** — concrete code plan:
   - `emailVerification: { sendVerificationEmail, sendOnSignUp: true }` +
     `requireEmailVerification` on sign-in.
   - `emailAndPassword: { sendResetPassword }` flow + frontend pages.
   - Password policy (min length ≥ 12; check against breached-password list —
     evaluate `have-i-been-pwned` integration).
   - Migration plan for the existing users (grandfather as verified? force verify
     on next login?).
3. **Rate limiting** — Better Auth limiter with database/secondary storage (survives
   restarts, multi-instance safe); custom rules for signup/reset endpoints; app-route
   limiter for writes/imports/invites (doc 02 §3).
4. **2FA (TOTP + backup codes)** — Better Auth `twoFactor` plugin; account-level
   lockout is built in (10 attempts / 15 min). Optional at launch, encouraged in UI;
   consider requiring for accounts with Fish Pie groups (multi-user blast radius).
5. **Session management** — review Better Auth session expiry/refresh defaults;
   "active sessions" list + revoke UI; secure cookie flags in prod
   (`useSecureCookies`); mobile token lifetime in SecureStore.
6. **Account lifecycle** — email-change with re-verification (both addresses
   notified); delete-account flow with fresh-session requirement + export prompt
   (doc 03 retention interacts here); login/new-device notification emails.
7. **Signup abuse** — disposable-email policy decision, per-IP signup caps, CAPTCHA
   contingency plan (don't add friction until abuse observed).
8. **Passkeys** (Better Auth plugin) — stretch; strong fit for a finance app,
   evaluate after 2FA ships.

## Sources (seed list — expand when writing)

- [Better Auth — Email & password](https://better-auth.com/docs/authentication/email-password) (verification, reset)
- [Better Auth — Options reference](https://better-auth.com/docs/reference/options)
- [Better Auth — 2FA plugin](https://better-auth.com/docs/plugins/2fa), [Passkey plugin](https://better-auth.com/docs/plugins/passkey)
- [Better Auth — Rate limit](https://better-auth.com/docs/concepts/rate-limit)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [NIST SP 800-63B — Digital Identity Guidelines](https://pages.nist.gov/800-63-4/sp800-63b.html) (password policy: length over composition rules, breached-password screening)
