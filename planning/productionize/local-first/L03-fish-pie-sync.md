# L03 — Fish Pie without a shared database

**Status:** Draft (first full pass 2026-07-04)
**The hard problem of this track.** Fish Pie (groups, invites, shared expenses,
settlements) currently works because all members' rows live in one Postgres we
operate. Local-first removes that. Everything else in Track B is engineering;
this is a redesign.

## What Fish Pie actually requires, decomposed

1. **Shared state**: group membership, categories/weights, expenses+splits,
   settlements — readable/writable by multiple people on different machines.
2. **Identity**: knowing *who* the other members are, across machines we don't
   control.
3. **Convergence**: everyone eventually sees the same balances (financial data —
   divergence is not cosmetic).
4. **The private/shared boundary** — already cleanly designed in the schema:
   personal ledgers (`transactions`/`postings`) stay private; only the `group_*`
   tables are shared, linked to private postings on each member's side. This
   boundary is the reason the redesign is *feasible*: only the small, append-mostly
   shared tables need to sync.

## Options

### F1 — Local edition ships single-user; Fish Pie is cloud-only

Fish Pie greys out unless you connect to a hosted have-fish (Track A). Zero new
design; splits the product story ("local tracker" vs "hosted collaboration").
**This is the correct v1 scope** regardless of the long-term answer — it decouples
the tracks' timelines.

### F2 — Settlement-file exchange (rejected)

Members export/import expense bundles by hand (AirDrop a JSON). No infrastructure,
fully offline — and miserable UX that falls apart at "who has the latest file."
CSV-import muscle memory doesn't excuse making *collaboration* manual. Reject.

### F3 — E2E-encrypted sync relay (the Actual Budget model) — recommended target

A small server we (or a self-hoster) run that stores and forwards **opaque encrypted
change messages** per group. Clients hold the keys; the relay never sees amounts,
descriptions, or member names — it sees blob sizes and timing. Precedent: Actual
Budget's sync server holds "an archival backup + messages with updates" and the
authors explicitly designed CRDT sync so the server needs no knowledge of the data.

- **Data model:** per-group append-only event log (expense added/edited, split set,
  settlement proposed/confirmed, member joined…), each event CRDT-timestamped with a
  hybrid logical clock; state = fold(events). Fish-pie data is append-mostly with
  soft deletes — a natural event-sourcing/CRDT fit. Use last-write-wins registers
  per field (Actual's approach) rather than heavyweight automerge/loro docs; our
  types are rows, not rich text. Two flows need explicit design, not LWW:
  **settlement confirmation** (two-party state machine — model as separate
  propose/confirm events so they commute) and **member removal vs. concurrent
  expense** (tombstone + rebalance rule).
- **Identity:** relay accounts return in minimal form (email + password/passkey,
  Better Auth again — on the *relay*, holding only identity, not ledgers). Group
  invites become key exchange: invite link carries the group key wrapped for the
  invitee (sealed to their relay public key). Key rotation on member removal.
- **Offline behaviour:** full function offline; events queue and reconcile on
  reconnect. Balances shown with a "pending sync" marker when the queue is
  non-empty.
- **Local ledger linkage:** each member's app materializes group events into their
  *private* postings exactly as the fish-pie services do today (`heal`,
  clearing-account postings) — that code largely survives; it just consumes events
  instead of shared rows.
- **This is also the business model**: free local app, **paid sync relay
  subscription** — the Obsidian Sync / Actual-hosted pattern. Converges with Track
  A's billing machinery (Stripe/Better Auth plugin, docs `05`) but with radically
  lower data liability: a breach of the relay leaks ciphertexts and emails, not
  ledgers. Self-hosters can run the relay free — same open-core posture as today.

### F4 — Pure P2P (LAN/Tailscale/iroh) — deferred, not rejected

For the *household* case (the actual current users!) devices share a LAN/tailnet:
direct sync with no relay at all. Beautiful fit for self-hosters; hostile to the
general public (NAT, discovery, "my partner's laptop is asleep"). The event-log
design in F3 is transport-agnostic — build F3, and P2P transport becomes a later
transport plugin, not a fork.

## Recommendation & sequencing

1. **v1 local edition: F1** (single-user; Fish Pie visible but gated on "connect to
   sync").
2. **Design spike:** event-log schema + settlement-confirmation state machine on
   paper; validate against every existing fish-pie test scenario (the test suite is
   a ready-made conformance corpus — port tests to run against the fold(events)
   materializer).
3. **F3 relay** as the collaboration + revenue phase. Rough effort: the CRDT/event
   layer 4–6 wks, relay service 2–3 wks, key-management UX 2–3 wks. This is the
   single biggest line item in Track B.
4. F4 transport later if self-hosting demand warrants.

## Open questions (tracked in ../PROGRESS.md)

- **LQ1:** Is multi-currency settlement math stable under event reordering?
  (Suspect yes given commutative propose/confirm design + rates pinned in events —
  needs the spike to prove.)
- **LQ3:** Does the relay also offer **personal multi-device sync** (desktop +
  laptop + phone for one user)? Same machinery, huge product value, makes the paid
  tier much more compelling than fish-pie-only sync. Leans yes; scope it in the
  spike. (This is also L08's dependency.)

## Sources

- [Actual Budget — Syncing across devices](https://actualbudget.org/docs/getting-started/sync/); [actual-server](https://github.com/actualbudget/actual-server) (relay holds backup + update messages only)
- James Long, ["A future for SQL on the web" / crdt.tech listing of Actual's approach](https://crdt.tech/implementations) — LWW-map + hybrid logical clocks in a shipping finance app
- [Kleppmann et al. — Local-first software](https://www.inkandswitch.com/local-first/) (the canonical essay; properties 1–7 map directly onto this design)
- [Hybrid Logical Clocks (Kulkarni et al.)](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [Automerge](https://automerge.org/) / [Loro](https://loro.dev/) — evaluated-and-probably-not libraries (row-shaped LWW is enough; keep for reference)
- [Obsidian Sync](https://obsidian.md/sync) — the free-local-app + paid-E2E-sync business precedent
- [iroh](https://www.iroh.computer/) — P2P transport candidate for F4
