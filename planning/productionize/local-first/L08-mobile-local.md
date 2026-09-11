# L08 — Mobile in the local model

**Status:** Outline — research queue. Blocked on L03's LQ3 decision (does the relay
do personal multi-device sync?) — that answer largely writes this doc.

## The problem

Today's Expo app is a thin companion that calls the backend over the tailnet. In the
local model there is no always-on backend: the "server" is a desktop binary that
sleeps when the laptop lid closes — exactly when you're out spending money.

## Options to develop (research queue)

1. **O1 — LAN/tailnet companion (status quo, degraded):** phone talks to the desktop
   binary when reachable; offline queue in the app for entries made while away
   (idempotent submit on reconnect). Cheapest path; keeps the current app almost
   unchanged; acceptable *only* for the household/self-hoster persona who already
   runs Tailscale. Queue design: entries are append-only quick-adds — low conflict
   risk — but define the reconciliation rules anyway.
2. **O2 — True local mobile + relay sync (the real answer, big):** SQLite on device
   (expo-sqlite), the L03 event-log/CRDT layer shared between desktop and mobile
   (TypeScript both sides — genuine code reuse), relay as the transport. Mobile
   becomes a *peer*, not a client. Depends entirely on L03 shipping; adds the L02
   schema to a third runtime. Scope honestly: this is a second product-sized effort.
3. **O3 — Drop mobile for local-track v1:** ship desktop-only, keep the mobile app
   pointed at Track A hosted instances. Defensible sequencing, poor travel story.

Likely recommendation (to validate when writing): **O1 for v1** (offline queue is a
bounded epic and helps every deployment mode), **O2 as the paid-sync flagship**
feature once L03 lands — "your ledger on every device, end-to-end encrypted" is the
subscription pitch.

## Also cover when writing

- Distribution unchanged (GitHub Releases/Obtainium; no Play billing entanglement —
  Track A doc 05 caveat stays dormant).
- SecureStore holds relay keys (interlock L07 §3).
- iOS question: Expo already targets it in principle; Apple Developer $99/yr is
  already budgeted by L05 signing — flag as separate scope decision.

## Sources (seed list)

- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Actual Budget mobile discussions](https://actualbudget.org/docs/faq/) — how a local-first finance app handles mobile (PWA/webview trade-offs)
- L03 (event log, relay, LQ3), L02 (schema on device), `mobile/lib/api.ts` (current client seam)
