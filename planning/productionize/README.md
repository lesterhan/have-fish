# Productionize have-fish

Research and planning for taking have-fish from a self-hosted personal tool to a small
public service. The priority ordering, agreed at kickoff (2026-07-04):

1. **Security and reliability infrastructure first** — users' financial data must be safe
   before anything else.
2. **Launch mechanics** — billing, legal, operations.
3. **Feature completeness** — rounded out after the platform is trustworthy.

This is a multi-month goal. The documents here are the map, not the sprint plan — each one
ends with a phased work breakdown that can be lifted into epics under `planning/epics/`
when we're ready to execute.

## How to use this directory

- **`PROGRESS.md` is the entry point for every session.** It records what has been
  researched, what each document covers, open questions, and what to do next. Read it
  first, update it last.
- Documents are numbered in rough execution-priority order. Each has a status header
  (`Draft` / `In review` / `Stable`) — treat `Outline` docs as a research queue, not as
  finished guidance.
- Sources are cited inline as footnote-style links at the end of each document so claims
  can be verified and read further.

## Document index

| # | Document | Topic | Status |
|---|----------|-------|--------|
| — | [PROGRESS.md](PROGRESS.md) | Cross-session tracker — read first | Living |
| 01 | [current-state-assessment.md](01-current-state-assessment.md) | Audit of the codebase & infra as of 2026-07-04 | Draft |
| 02 | [data-security.md](02-data-security.md) | Protecting financial data & PII — top priority | Draft |
| 03 | [compliance-pci-privacy.md](03-compliance-pci-privacy.md) | PCI DSS, PIPEDA/GDPR, retention & erasure | Draft |
| 04 | [auth-hardening.md](04-auth-hardening.md) | Email verification, 2FA, rate limits, sessions | Outline |
| 05 | [subscriptions-billing.md](05-subscriptions-billing.md) | Monthly entitlements/subscriptions on Better Auth | Draft |
| 06 | [infrastructure-reliability.md](06-infrastructure-reliability.md) | Hosting, backups, DR, TLS, scaling | Outline |
| 07 | [observability-operations.md](07-observability-operations.md) | Logging, monitoring, alerting, incident response | Outline |
| 08 | [launch-readiness.md](08-launch-readiness.md) | Legal, ToS/privacy policy, support, cost model | Outline |

## Non-negotiable product constraints (from CLAUDE.md vision)

Every recommendation in these documents respects:

- **No bank connections** — no OAuth to financial institutions, no third-party sync.
  (This is also our biggest compliance advantage; see doc 03.)
- **Portable data** — hledger export remains the escape hatch; production hardening must
  not trap data.
- **Multi-currency first-class** — infra choices (e.g. FX rate fetching) must stay
  reliable at public scale.
