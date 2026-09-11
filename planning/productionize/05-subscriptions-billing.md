# 05 — Subscriptions, entitlements & billing

**Status:** Draft (architecture + provider comparison 2026-07-04; pricing/tier design TBD)
**Answers the kickoff question:** *"what would be needed to have monthly entitlement or
subscriptions tied to accounts?"*

## The short answer

Four layers of work, roughly in order:

1. **Auth prerequisites** (doc 04): verified emails, password reset, and a persistent
   rate limiter. You cannot bill an account whose email you can't trust or recover.
2. **A payment provider integration** — recommendation: **Better Auth's official
   Stripe plugin** (`@better-auth/stripe`), because it lives exactly where our
   accounts live and gives us a `subscription` table, Stripe customer creation on
   signup, checkout/portal flows, and verified webhook handling out of the box.
3. **An entitlement layer in our API** — middleware that resolves the user's plan and
   gates features/limits server-side.
4. **Billing operations** — taxes, refunds, dunning, invoices, support (mostly
   outsourced to the provider; decisions still required).

Realistic effort: **3–6 weeks** of focused work after the auth prerequisites, most of
it in the entitlement layer and its tests, not the Stripe wiring.

## Provider decision (open question Q3)

| | **Stripe direct** (+ Better Auth plugin) | **Merchant of record** (Paddle, Lemon Squeezy, Polar) |
|---|---|---|
| Fees | ~2.9% + 30¢ (+0.5% billing) | ~5% + 50¢ |
| **Sales tax/VAT** | **Ours to handle** — Stripe Tax computes (0.5%/txn) but *we* must register & remit where thresholds are met (Canadian GST/HST registration required at $30k CAD/4 quarters; each country/state its own rules) | **Theirs** — they are the seller, they remit globally. This is the killer feature for a one-person operation |
| PCI | SAQ A with hosted Checkout (doc 03) | Effectively out of scope |
| Better Auth fit | First-party plugin | Manual webhook → user linkage (Polar also has a Better Auth plugin) |
| Payout/control | Full control, custom flows | Less control, occasional payout friction |
| Multi-currency pricing | Good (Stripe multi-currency prices) | Good |

**My recommendation:** if the plan is world-open sales, a **merchant of record** buys
freedom from international tax administration at the cost of ~2 points of margin —
worth it at small scale. If launching **Canada/US-first** (as doc 03 recommends),
**Stripe + Better Auth plugin** is the cleaner architecture and GST/HST registration
is a manageable, well-documented process. Decide with Q1 (jurisdictions) since they're
the same decision. The entitlement layer below is provider-agnostic either way.

## Architecture with the Better Auth Stripe plugin

### What the plugin gives us

- **Schema**: adds a `subscription` table (plan, status, period end, seats,
  `referenceId`) and `stripeCustomerId` on `user` — a Drizzle migration via the
  standard `db:generate` flow.
- **Customer lifecycle**: Stripe Customer created on signup
  (`createCustomerOnSignUp`).
- **Checkout & upgrades**: `authClient.subscription.upgrade({ plan, successUrl,
  cancelUrl })` → hosted Stripe Checkout (keeps us SAQ A, doc 03); plan switches
  prorate by default.
- **Webhooks**: mounts a handler with signature verification; processes
  `checkout.session.completed`, `customer.subscription.updated/deleted` to keep the
  local `subscription` row in sync.
- **Trials, cancel-at-period-end, restore**, and seat counts (future: group/household
  plans via `referenceId` — one active subscription per reference).

### What we build ourselves — the entitlement layer

The plugin answers "what did they buy"; our API must answer "what may they do."

1. **Plan definitions in code** (single source of truth):

   ```
   free:  { accounts: 10, importsPerMonth: 2, fishPieGroups: 1, ... }
   plus:  { accounts: ∞, importsPerMonth: ∞, fishPieGroups: 5, retention: full }
   ```

2. **Entitlement middleware** after the session guard in `app.ts`: resolve the
   user's active subscription (cache it on the context; one query), attach
   `c.get('plan')`. Feature-gated routes check limits server-side — **never trust
   the client's idea of the plan**.
3. **Grace-period semantics**: `past_due` → read-only or full access for N days
   (Stripe Smart Retries handles dunning); `canceled` → downgrade to free at period
   end, **never lock users out of their own data** — free tier must always allow
   **export** (vision principle: portable data; also a GDPR/PIPEDA portability
   requirement).
4. **Downgrade policy** for over-limit accounts (e.g. >10 accounts on free after
   cancel): read-only over the limit, not deletion.
5. **Tests**: entitlement middleware unit tests + route tests per gated feature
   (free user hits the 11th account → 402/403 with a typed error the frontend can
   render as an upgrade prompt).
6. **Webhook resilience**: idempotent handlers; nightly reconciliation job comparing
   local `subscription` rows against the Stripe API (webhooks get missed).

### Free-tier design (product decision, sketch)

Anchor on: free = fully useful single-user tracker (funnel + goodwill + the
self-hosting community), paid = multi-currency power features + Fish Pie collaboration
+ CSV import automation (rules mining). Pricing research is future-session work;
comparables: Actual Budget ($0 self-host), YNAB (~$15/mo), Lunch Money (~$10/mo).

## Mobile caveat (Android)

Google Play requires **Play Billing** (15–30% cut) for in-app purchases of digital
subscriptions *if distributed via Play Store*. Today the APK ships via GitHub
Releases/Obtainium — no Play policy applies. If we ever list on Play: make the app a
pure companion (no purchase flow, no "buy here" links) — reader apps precedent — or
integrate Play Billing. Decision only needed if/when Play distribution happens.

## Work breakdown

**Phase B0 (blockers, from doc 04):** email provider + verification + password reset;
persistent rate limiting.
**Phase B1 — provider + plumbing (≈1–2 wks):** Q1/Q3 decision; Stripe account (or
MoR); plugin install + migration; checkout/portal/webhook flows; staging-mode E2E.
**Phase B2 — entitlements (≈2–3 wks):** plan definitions, middleware, per-feature
gates + tests, downgrade/grace semantics, export-always-free guarantee, frontend
upgrade UX + billing settings page (portal link), webhook reconciliation job.
**Phase B3 — billing ops (≈1 wk + ongoing):** tax setup (Stripe Tax + GST/HST
registration, or MoR sidesteps), refund policy (doc 08), dunning emails config,
invoice branding, SAQ A completion (doc 03).

## Sources

- [Better Auth — Stripe plugin](https://better-auth.com/docs/plugins/stripe) — subscriptions, webhooks, customer-on-signup, reference IDs/seats
- [Better Auth — Autumn billing plugin](https://better-auth.com/docs/plugins/autumn) (alternative abstraction layer)
- [Stripe — Checkout](https://docs.stripe.com/payments/checkout), [Billing subscriptions](https://docs.stripe.com/billing/subscriptions/overview), [Smart Retries/dunning](https://docs.stripe.com/billing/revenue-recovery/smart-retries), [Stripe Tax](https://docs.stripe.com/tax)
- [CRA — GST/HST small-supplier threshold ($30k)](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/when-register-charge.html)
- [Paddle — MoR model](https://www.paddle.com/blog/what-is-merchant-of-record), [Lemon Squeezy](https://www.lemonsqueezy.com/), [Polar](https://polar.sh/)
- [Google Play — Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738)
- Doc 03 Part A for the PCI framing of checkout integration choices.
