# 07 — Observability & operations

**Status:** Outline — research queue for a future session. Interlocks: logging
redaction rules belong to doc 02 §6; breach-response obligations to doc 03.

## Framing

Today: `hono/logger` to stdout, no metrics, no alerting, no error tracking. As a solo
operator you can't watch dashboards — the design goal is **alerts find you, with
enough context to act from a phone**, and everything else is queryable after the fact.

## Sections to write (research queue)

1. **Structured logging** — pino (or equivalent) JSON logs; request IDs; the PII
   redaction list from doc 02 §6 implemented as a serializer test (a unit test that
   fails if an email/token appears in log output). Retention caps.
2. **Error tracking** — Sentry (generous free tier, Hono + SvelteKit + React Native
   SDKs) vs. self-hosted GlitchTip. Scrub PII in beforeSend. This is the highest
   value-per-hour item in this doc.
3. **Audit log** — implement doc 02's security-event trail: append-only table,
   event taxonomy (auth events, exports, deletions, invites, billing changes),
   admin query path. Feeds PIPEDA breach assessment (doc 03).
4. **Metrics & health** — start minimal: uptime monitor on `/health` + a
   DB-touching readiness endpoint; host metrics (node_exporter or provider
   dashboard); a handful of app counters (signups, imports, webhook failures,
   FX-rate staleness). Prometheus+Grafana only if VPS-hosted and appetite exists —
   don't build a metrics stack before there are users.
5. **Alerting policy** — page-worthy (service down, DB unreachable, backup failed,
   restore-test failed, disk >85%, webhook failures accumulating) vs. daily-digest
   (error spikes, auth anomalies, stale FX). Delivery: email + ntfy.sh push.
   Every alert links to a runbook section.
6. **Runbooks** — service down; restore-from-backup (doc 06); secret rotation
   (doc 02 §4); **security-incident/breach response** (contain → assess RROSH →
   notify per doc 03 → record); suspected account takeover; Stripe webhook outage
   reconciliation (doc 05).
7. **Admin tooling** — a minimal internal admin surface (user lookup, disable
   account, resend verification, view audit trail) — CLI scripts are fine at first;
   decide what *never* gets built (no admin read-access to user ledgers without
   consent — write this into the privacy policy, doc 08).
8. **Support-adjacent ops** — user-report intake → triage → incident? loop;
   BUGS.md graduates to a real tracker.

## Sources (seed list — expand when writing)

- [pino](https://getpino.io/) — structured logging (+ redaction paths feature)
- [Sentry](https://docs.sentry.io/) / [GlitchTip](https://glitchtip.com/)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [ntfy.sh](https://ntfy.sh/) — self-hostable push alerts
- [Google SRE Workbook — alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)
- [OPC breach guidance](https://www.priv.gc.ca/en/privacy-topics/business-privacy/breaches-and-safeguards/privacy-breaches-at-your-business/gd_pb_201810/) — the notify/record steps the incident runbook must encode
