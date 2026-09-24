# 08 — Launch readiness (legal, support, cost, everything else)

**Status:** Outline — research queue. Catch-all for the kickoff question *"any other
concerns around launching a small service like this to the public?"* — enumerated
here so nothing is forgotten; each section gets researched properly in later sessions.

## Sections to write (research queue)

1. **Business entity & liability (Q5)** — sole proprietorship vs. federal/provincial
   incorporation. Holding strangers' financial data with contractual promises is
   exactly when limited liability earns its keep; also needed for Stripe business
   verification, and general liability/cyber insurance quotes. **Flag: real lawyer
   conversation, not a document we write ourselves.**
2. **Terms of Service & Privacy Policy** — must cover: no-financial-advice
   disclaimer, data practices matching doc 03 (retention schedule, breach
   commitments, subprocessor list — host, email provider, Stripe/MoR), refund
   policy, acceptable use, account termination, liability caps, governing law.
   Quebec/French-language question (doc 03). Sourcing: template services
   (Termly/GetTerms) + lawyer review vs. lawyer-drafted. Subprocessor list is also
   a PIPEDA "openness" requirement.
3. **Positioning & trust** — a privacy-forward finance tool sells on trust:
   security page (what we do — doc 02 summary — and what we *never* do: no bank
   credentials, no data selling, export anytime), self-hosting remains free
   (community + credibility), transparent changelog. Decide: is the repo staying
   public? (License is MIT — a hosted commercial offering is fully permitted,
   but MIT also lets anyone else host a competing instance; decide if that's fine
   (probably yes — trust/ops are the moat) or if a license change is wanted, and
   decide **before** accepting outside contributions, which lock the license in.)
4. **Naming/trademark check** — "have-fish 有鱼" collision search before spending on
   branding; domain acquisition.
5. **Support model** — email-only at launch; target response time stated in ToS;
   docs site (user guide covers CSV import formats — the main support magnet);
   feedback channel. Realistic solo-operator budget: ~2–5 hrs/week.
6. **Onboarding & first-run** — public signup funnel (verified email → empty state →
   first import success). The current app assumes an expert operator; a public user
   needs demo data or a guided first account. (Feature-work adjacent — coordinate
   with the feature roadmap, but a launch blocker in the conversion sense.)
7. **Cost model & runway** — monthly: hosting + managed DB (~$25–50), email
   (~$10), domain, Sentry free tier, backups storage (~$5), insurance (?),
   EU rep if applicable (doc 03), incorporation amortized. Break-even subscriber
   count at candidate price points (doc 05 pricing).
8. **Beta strategy** — closed beta (invite-only flag) → open. Invite gating doubles
   as the abuse throttle while auth hardening (doc 04) soaks. Feature flags for
   billing so it can ship dark.
9. **Data-migration path for existing self-hosters** — import-from-journal or
   DB migration tool, so the existing user (you/household) moves onto prod cleanly;
   also the story for "hosted → self-hosted" churn (export already covers it — test
   the loop).
10. **Launch checklist** — final gate: all Phase S1+S2 items (doc 02), auth Phase B0
    (doc 04), backups tested (doc 06), runbooks written (doc 07), policies live,
    SAQ A if billing on day one (doc 03). Assemble as a single checkable list when
    the other docs stabilize.

## Sources (seed list — expand when writing)

- [Corporations Canada — incorporation basics](https://ised-isde.canada.ca/site/corporations-canada/en)
- [CRA — GST/HST registration](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/when-register-charge.html)
- [Termly](https://termly.io/) / [GetTerms](https://getterms.io/) — policy template services (lawyer review still advised)
- [OPC — PIPEDA in brief](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/) — openness/accountability principles the policy must satisfy
- [Stripe Atlas guides — SaaS launch legal basics](https://stripe.com/atlas/guides) (US-centric; adapt)
