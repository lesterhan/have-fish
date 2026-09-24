# 03 — Compliance: PCI DSS & privacy law

**Status:** Draft (first full pass 2026-07-04)
**Answers the kickoff question:** *"will there be any PCI DSS concerns?"* — short
answer: **yes but small, and entirely avoidable-by-design.** Detail below, then
privacy-law obligations, which are the *bigger* compliance surface for this app.

## Part A — PCI DSS

### Does PCI DSS apply to have-fish today?

**No.** PCI DSS governs the storage, processing, and transmission of *cardholder data*
(primarily the PAN — the card number). have-fish deliberately holds none:

- No bank connections (vision principle #1) — we never see card credentials.
- Transactions are manual entries or bank-CSV imports: amounts, dates, descriptions.
- We don't charge anyone money yet, so we're not even a "merchant."

One real caveat: **bank CSV exports sometimes embed card numbers** (usually masked,
occasionally full PANs in some banks' statement exports) inside description fields.
Storing full PANs — even accidentally, even user-uploaded — would create cardholder
data storage. Mitigation (cheap, do it in Phase S2): a PAN-pattern scrubber in the CSV
import pipeline that masks anything matching a 13–19-digit Luhn-valid sequence to
`****1234`. This also protects users from themselves and keeps us defensibly out of
scope. (First-6/last-4 masked forms are not cardholder data.)

### PCI DSS when we add subscriptions (doc 05)

The moment we accept card payments we become a **merchant** and PCI DSS applies — but
scope depends entirely on integration architecture:

| Integration | Our exposure | Assessment burden |
|---|---|---|
| **Stripe Checkout / hosted payment page (redirect)** | Card data never touches our servers or our page | **SAQ A** — the minimal self-assessment questionnaire (~30 requirements, mostly "confirm your provider is compliant, use TLS, manage passwords") |
| Stripe.js/Elements (iframe on our page) | Our page hosts the iframe | SAQ A, **plus** (v4.0.1) eligibility hinges on script protection of the payment page — requirements 6.4.3 (script inventory/authorization) and 11.6.1 (tamper detection) pressure |
| Stripe API direct (card fields we render) | Card data transits our servers | SAQ D — hundreds of requirements. **Never do this.** |
| Merchant of record (Paddle/Lemon Squeezy) | They are the merchant, not us | Effectively none for us |

**Recommendation:** hosted redirect checkout (or merchant of record — see doc 05,
open question Q3). Under PCI DSS v4.0.1 (all requirements mandatory since
March 31, 2025), the SSC's FAQ 1588 confirms that the new "not susceptible to script
attacks" SAQ A eligibility criterion **does not apply to full-redirect merchants** —
another reason to prefer redirect over embedded Elements at our size. Stripe's
dashboard walks merchants through the SAQ A annually; budget a day per year for it.

**PCI never applies to the financial data users track in the app** — a user typing
"Visa payment $500" is not cardholder data. PCI is only about *accepting payments*.

### PCI action list

1. Design decision recorded: **redirect-based checkout only** (doc 05).
2. Phase S2: PAN scrubber in CSV import (Luhn-check + mask).
3. At billing launch: complete SAQ A via Stripe's compliance flow; keep TLS/security
   headers (doc 02 §1) — SAQ A requires them anyway.
4. Never log full card data (we never see it; keep it that way in webhook payloads —
   Stripe sends only last4/brand).

## Part B — Privacy law (the bigger deal)

Financial ledgers are among the most sensitive PII categories short of health data.
Which laws bind us depends on **who we accept as users** (open question Q1).

### PIPEDA (Canada) — applies from day one

As a Canadian operator handling personal information in commerce, PIPEDA applies
regardless of company size. Key obligations:

- **The 10 fair information principles** — accountability, consent, limiting
  collection/use/retention, safeguards, openness, access, challenging compliance.
  Practically: a real privacy policy, a named accountable person (you), and data
  practices that match the policy.
- **Mandatory breach reporting** (since Nov 2018): breaches posing a "real risk of
  significant harm" (RROSH) must be reported to the Privacy Commissioner and affected
  individuals "as soon as feasible." **Financial loss and identity theft are named
  categories of significant harm** — a leak of our DB almost certainly qualifies.
- **Breach record-keeping**: records of *every* breach (even non-reportable) kept
  **24 months**. Fines up to **$100k per violation** for failing to report/record.
- **Access & correction rights**: users can demand what we hold and fix errors.
  hledger export already nearly satisfies access; add account data (email, settings).

→ Deliverables: privacy policy (doc 08), breach-response runbook (doc 07), breach
register template, retention policy (below).

### GDPR (EU/EEA) — only if we serve EU users

If we market to or knowingly serve EU residents: lawful basis mapping, data-subject
rights (access/erasure/portability — mostly already designed-in), 72-hour breach
notification to a supervisory authority, records of processing, and appointing an
**EU representative** (Art. 27) since we have no EU establishment. That last one has
real cost (~€500–1500/yr for a rep service).
**Recommendation for v1: launch Canada/US-first**, geo-gate or at least don't market
to the EU, revisit when there's revenue. (US: no federal law; state laws like CCPA
kick in at thresholds — $25M revenue / 100k consumers — far beyond us.)

### Quebec Law 25 (if serving Quebec residents — we will)

Private-sector law with GDPR-like teeth, fully in force since Sept 2023: named privacy
officer (defaults to CEO — fine, that's you), privacy policy in clear language,
breach notification to the CAI, and **privacy impact assessment for communicating PI
outside Quebec** (our servers/backups). Mostly satisfied by doing the PIPEDA work
properly + a short written PIA. French-language service obligations (Bill 96) may
apply to the user-facing policy — flag for legal review in doc 08.

### Retention, deletion, and the soft-delete tension

Current design keeps everything forever (soft deletes) and hard-deletes users via FK
cascade. Decisions needed:

1. **Retention schedule** (write into the privacy policy):
   soft-deleted records purged after N days (propose 90); sessions per Better Auth
   expiry; audit logs 1–2 yrs; backups age out ≤ 90 days (so erasure becomes real
   within a bounded window — document this in the policy; purging individuals from
   backups is not expected practice, aging them out is).
2. **User deletion vs. group data**: cascade currently erases the departed member's
   splits/settlements, silently rewriting other members' ledgers. Design a
   tombstone: keep group financial rows, replace the user reference with an
   anonymized placeholder. This is both a correctness and a privacy design task —
   needs its own epic.
3. **Invitee emails** (PII of non-users): expire pending invites (e.g. 30 days) and
   purge the email; don't retain declined invites' emails.
4. A scheduled **purge job** — soft-delete without eventual purge fails "limiting
   retention" under PIPEDA principle 5.

### Compliance action list (merged into phases from doc 02)

- Phase S1: breach-response runbook skeleton + breach register template.
- Phase S2: privacy policy + ToS (doc 08); retention schedule implemented as purge
  job; PAN scrubber; invite expiry; data-export endpoint covering account PII.
- Billing launch: SAQ A; tax/registration questions (doc 05/08).
- Post-launch: Law 25 PIA memo; EU decision (Q1); user-deletion tombstone epic.

## Sources

- [PCI SSC — SAQ A (v4.0)](https://listings.pcisecuritystandards.org/documents/PCI-DSS-v4-0-SAQ-A.pdf)
- [Hyperproof — PCI DSS 4.0 new SAQ A eligibility criteria](https://hyperproof.io/resource/pci-dss-4-0-update-new-saq-a-eligibility-criteria/)
- [DWT — PCI SSC clarifies obligations for e-commerce merchants that outsource processing (FAQ 1588)](https://www.dwt.com/blogs/privacy--security-law-blog/2025/03/pci-faqs-card-processing-ecommerce-merchants)
- [Stripe — Guide to PCI compliance](https://stripe.com/guides/pci-compliance)
- [cside — Can you use Stripe for PCI DSS?](https://cside.com/blog/can-you-use-stripe-for-pci-dss) (6.4.3/11.6.1 nuance for embedded pages)
- [OPC — Mandatory reporting of breaches of security safeguards](https://www.priv.gc.ca/en/privacy-topics/business-privacy/breaches-and-safeguards/privacy-breaches-at-your-business/gd_pb_201810/)
- [Norton Rose Fulbright — PIPEDA mandatory breach reporting](https://www.nortonrosefulbright.com/en/knowledge/publications/ac3ee5c4/mandatory-privacy-breach-reporting-requirements-coming-into-force-in-canada-november-1)
- [ComplyDog — PIPEDA compliance guide for SaaS](https://complydog.com/blog/pipeda-compliance-guide-canadian-privacy-law-saas-companies)
- [GDPR Art. 27 — EU representative](https://gdpr-info.eu/art-27-gdpr/); [Art. 33 — breach notification](https://gdpr-info.eu/art-33-gdpr/)
- [CAI Québec — Law 25 obligations for enterprises](https://www.cai.gouv.qc.ca/entreprises/)
