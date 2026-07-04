# L06 — Monetization & licensing (local model)

**Status:** Outline — research queue. Interlocks hard with L03 (paid sync is the
strongest model) and Track A doc 05 (shared billing machinery).

## The landscape (frame for the full doc)

Local-first kills the SaaS default ("pay or lose access") — the app runs on their
machine forever. Honest options:

| Model | Precedent | Fit |
|---|---|---|
| **Free app + paid E2E sync subscription** | Obsidian, Actual (hosted) | **Best fit**: recurring revenue, the service actually costs us something, aligns with L03 relay, keeps local app fully free (community/self-host goodwill preserved) |
| One-time purchase + license key | classic shareware, many Tauri apps | Simple, but MIT-licensed source makes enforcement soft (key check is trivially removable from a fork — treat keys as honesty-tolls, not DRM) |
| Paid major versions | Sketch model | Update-channel complexity; awkward with auto-migrating DB |
| Donations/sponsorware | Actual (OSS core) | Not a business |

## Sections to write (research queue)

1. **Recommendation to develop: free local app + paid sync** (fish-pie sync + LQ3
   personal multi-device sync as the paid feature set). Price research vs Obsidian
   Sync ($4–8/mo) and hosted-Actual providers (~$2–5/mo).
2. **License-key mechanics** (if any paid-local tier): offline-verifiable signed
   keys (Ed25519), no phone-home requirement (privacy stance forbids it);
   Paddle/Lemon Squeezy/Polar license-key APIs for issuance; grace behaviour =
   never lock data, degrade to free features.
3. **Relay billing** = Track A doc 05 machinery almost verbatim (Better Auth +
   Stripe plugin on the *relay's* accounts; or MoR per Q3) — the relay is a small
   SaaS with tiny data liability. PCI story identical (SAQ A / MoR, doc 03).
4. **Open-source posture decision** (sharpens Track A doc 08 §3): MIT + hosted
   relay + signed official binaries is coherent (Actual's model). Decide whether
   sync protocol/relay is also OSS (self-hosters) — recommendation lean yes;
   revenue moat = convenience + trust, not secrecy.
5. **Taxes**: same GST/HST + MoR analysis as doc 05 Phase B3; digital-goods VAT if
   selling license keys worldwide → MoR strongly favoured for one-time sales.
6. **Cost floor** from L05 (signing ~US$320/yr, website, relay hosting ~$20/mo) →
   break-even math per model.

## Sources (seed list)

- [Obsidian pricing](https://obsidian.md/pricing); [Actual Budget — hosting/pricing landscape](https://actualbudget.org/docs/install/)
- [Lemon Squeezy license API](https://docs.lemonsqueezy.com/api/license-keys), [Paddle](https://developer.paddle.com/), [Polar license keys](https://docs.polar.sh/features/benefits/license-keys)
- [Keygen — open-source licensing server](https://keygen.sh/) (if self-issuing keys)
- Track A docs: `../05-subscriptions-billing.md` (Stripe/Better Auth, tax, MoR), `../03-compliance-pci-privacy.md`
