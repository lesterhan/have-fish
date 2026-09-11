# 00 — Direction: what we are building and why

**Status:** Decision record. **Read this first.** Started 2026-09-11.

This document is the single source of truth for the productionization direction. The
numbered documents (`01`–`08`) and the `local-first/` documents (`L01`–`L08`) are
**research**, dated 2026-07-04 and still accurate as research. Where they present an
open choice that has since been decided, this document is what holds. Where they
describe how something works, they hold.

The two-track framing in the old `README.md` — cloud SaaS versus local-first, decide
later — is **resolved**. See D1.

## The product, in a paragraph

have-fish is a personal finance tracker you install on your machine. Your ledger lives
in a file you own, and the app works completely without a network — entering, importing,
reporting, reconciling. It is free. Optionally you can pay for a sync service that
replicates your ledger between your own devices and powers Fish Pie, the shared-expense
feature, with other people. The sync service never sees your data: it relays ciphertext.
If you stop paying, or we disappear, the app and every transaction in it keep working.

## Decisions

### D1 — Local-first executable, free; sync and multiplayer as a paid subscription
**2026-09-11. Resolves LQ4 (Track A vs B vs both) and L06's model question.**

We are not building a cloud service that holds other people's ledgers. Track A
(documents `01`–`08`) is **superseded as a product direction**, and survives as research
for the relay, which is a miniature version of it — see "What survives from Track A".

Monetization is the Obsidian / Actual Budget pattern: free local app, paid sync. The
alternative considered and rejected was a flat fee for the app plus a subscription for
multiplayer. It fails for two reasons. The source is MIT and public, so a licence key in
it is an honesty-toll rather than DRM (`L06`). And it charges for the part that costs us
nothing to run while giving away the part that costs us money every month. Paid sync
charges for the thing with a real marginal cost, which is the honest structure.

#### The licence split
**2026-09-11.**

**The local application stays MIT and public, permanently — including export.** The code
that touches your ledger is auditable by the people whose ledger it is. That is the whole
claim, and it is not worth much if it can be withdrawn later.

**The sync service is private and proprietary.** It is a service, it costs money to run,
and charging for it is a separate matter from the app.

Three consequences, and the first one binds immediately:

1. **Relay code can never land in this repository.** A published MIT licence cannot be
   withdrawn from code already released under it. The sync service therefore starts life
   in [`lesterhan/have-fish-ops`](https://github.com/lesterhan/have-fish-ops), from its first commit — not migrated there later.
2. **The sync protocol and the client half of sync stay MIT**, because they run on the
   user's machine and touch their data, which is the point. So anyone can read the client
   and write their own relay. That is the self-hosting escape hatch working as intended,
   and it means the private service is **not a moat**. The moat is convenience and trust.
3. **E2EE becomes load-bearing for trust, not just liability** (D6). The honest pitch is:
   you cannot audit my server, but you can audit the client that encrypts before it sends
   and verify the server never receives plaintext. The licence split and D6 hold each
   other up.

### D2 — The single-player / multiplayer boundary
**2026-09-11.**

1. **The personal ledger is single-player.** Reads, writes, computation and import never
   require the network.
2. **Fish Pie is multiplayer.** It requires the sync service, says so plainly, and is
   unavailable rather than quietly degraded.
3. **Where they meet, the personal side wins** and the shared part defers to a queue.

Stated as a principle:

> **The ledger is always writable. Agreements with other people need the service.**

Money movement is a fact about your own accounts — always recordable, always local. What
a movement *means* socially (this was a shared expense; this settled a debt) is an
agreement, and an agreement needs the other party. So any single-player action that wants
a multiplayer answer **records the money now and queues the meaning for later**.

Two worked examples. A bank row matches a split rule during an offline import → it
imports as a plain expense, tagged unresolved, and surfaces later as something to finish.
You hand someone cash in a market with no signal → you cannot record a *settlement*, but
you can record the cash leaving your wallet and attach it to a settlement later.

This suits a double-entry app: the postings are the truth, the labels are interpretation.

### D3 — Three connection states, and "never linked" is not "offline"
**2026-09-11.**

| State | Personal ledger | Fish Pie |
|---|---|---|
| **Never linked** | Fully functional | **Absent**, not disabled |
| **Linked, online** | Fully functional | Live |
| **Linked, offline** | Fully functional | Unavailable, or last-synced read-only |

A user who never wants shared expenses must never see a permanently greyed-out tab for
a feature they will not use. This is a product decision, not a technical one.

### D4 — Sync is automatic, not manual
**2026-09-11.**

Sync runs whenever the service is reachable, never blocks the UI, and is not a button
the user presses.

The initial instinct was deliberate sync — "multiplayer when I want it", by analogy with
a game's single-player save. The analogy breaks, because single-player saves never merge.
Long divergence windows are precisely what produce real conflicts: the same CSV imported
twice, the same account renamed differently on two devices. Deliberate sync is therefore
the *harder* engineering problem, not the easier one. What is actually wanted is "never
**wait** for the network", which automatic-when-reachable, non-blocking sync delivers
without the divergence.

### D5 — The relay carries personal multi-device sync, not only Fish Pie
**2026-09-11. Resolves LQ3 (was "leaning yes").**

D2 makes the personal ledger a thing that exists on several replicas, so replication of
it is a first-class feature rather than a Fish Pie side effect. It is also the stronger
subscription pitch — "your ledger on every device, end-to-end encrypted" sells better
than shared-expense sync — and it is what unblocks true local mobile (`L08` O2).

### D6 — Encryption: plaintext locally, end-to-end encrypted on the relay
**2026-09-11. Resolves Q2; narrows LQ2.**

Local data is a plaintext SQLite file protected by OS disk encryption and directory
permissions. The risk profile is deliberately modelled on hledger or a spreadsheet: a
file on a disk you control. Passphrase encryption of the local file stays deferred
(`LQ2`) — key-management UX, where a forgotten passphrase means a lost ledger, costs
more than the marginal coverage.

The relay is the opposite: it stores **opaque encrypted change messages** and never sees
amounts, descriptions or member names. This is what makes operating it tolerable — a
breach leaks ciphertext and email addresses, not ledgers — and it is what shrinks the
privacy and breach-notification obligations in `03` to nearly nothing.

Note this reverses an earlier judgement that E2EE was unnecessary. That judgement was
scoped to a personal tool on a private tailnet, where it was correct. Holding other
people's financial data changes the premise.

### D7 — Form factor: compiled Bun binary now, Tauri wrapper later
**Per `L01`, confirmed 2026-09-11.**

`bun build --compile` produces one executable per platform containing the existing Hono
app, which binds `127.0.0.1`, serves the SvelteKit build as embedded static assets, and
opens the user's browser. Tauri later wraps *that same binary* as a sidecar, so Option A
is a prerequisite of Option B rather than throwaway work.

The seam is `HAVEFISH_MODE=local|server`. The route and service layer is identical in
both; only the edges differ — auth middleware, database driver, static serving. **Keeping
that seam narrow is the central architectural discipline of this project.** One
implementation hosted in two places is not a chasm; two implementations is.

### D8 — Database: SQLite
**Per `L02`, confirmed 2026-09-11.**

One file the user can see, copy and back up, which is a product feature here rather than
an implementation detail. `bun:sqlite` is built into the runtime and works inside
compiled binaries. PGlite was the alternative — zero schema change, but a WASM Postgres
is the wrong place for novelty in the durability layer of a finance app, and it cannot
run on React Native, which `L08` O2 needs.

### D9 — Fish Pie v1 is gated on connecting to sync
**Per `L03` option F1.**

The first local release ships single-user. Fish Pie is visible but gated behind
"connect to sync". This decouples the release from the sync redesign, which is the
single largest work item in the whole plan (`L03` estimates 8–12 weeks for the event
log, relay and key management combined).

### D10 — Export scope, and export is the sync format
**2026-09-11.**

What must be able to leave: accounts, transactions, postings — enough to walk away to
hledger, a spreadsheet, or another app. Fish Pie group metadata and spending summaries
are analysis and social bookkeeping; they do not need to leave, because you can recompute
them once you have the ledger. The money side of Fish Pie leaves anyway, since
settlements and splits write real transactions and postings into your own ledger.

The export serialization and the sync payload are **the same format**. This makes the
export work load-bearing rather than a side feature, and makes bootstrapping a new
replica the same operation as restoring a backup.

## Do these now, regardless of everything above

From `01`, audited 2026-07-04 and believed still true. These affect the deployment that
exists today, not the one being planned.

1. **There are no backups.** One Docker volume, no dumps, no offsite copy, no tested
   restore. Everything else on this list is recoverable; this is not.
2. **No password reset and no email transport**, so a forgotten password is permanent
   lockout. The `emailVerified` column exists and nothing ever sets it.
3. **Postgres is published on host port 8886**, containers run as **root**, and there is
   no rate limiting on any application route.
4. **The per-route IDOR audit has never been done.** Tests were written for correctness,
   not for adversarial access, and Fish Pie is genuinely multi-user today.
5. **CI has no dependency audit, secret scanning or image scanning.**

Items 1 and 2 are worth doing this month whatever happens to the rest of this plan.

## What is public and what is private

The licence split creates a second split, in the planning material. The rule:

> **Anything describing an unfixed weakness in a running system, or personal and business
> affairs, is private. Everything else is public.**

Under that rule the direction, the design research and the architecture all stay here, in
the open. Publishing them is fine and probably good — an open-core project's roadmap is
part of how it earns the trust that D1 says is the actual moat.

Two documents fail the rule and live in [`lesterhan/have-fish-ops`](https://github.com/lesterhan/have-fish-ops) instead:

- **`01-current-state-assessment.md`** — a detailed inventory of unfixed security gaps in
  a live deployment. The source it audits is already public, so it discloses little that
  reading the code would not, but it collates the work for an attacker and the cost of
  keeping it private is zero. Bring it back once the gaps it lists are closed.
- **`02-data-security.md`** — partly remediation guidance (fine to publish) and partly a
  statement that the multi-tenancy audit has never been done (not fine, yet).

**Be honest about what this achieves.** Both documents have been sitting on the public
branch `claude/productionize-security-planning-yo4s82` in this repository since
2026-07-04. Treat their contents as already disclosed. Keeping them out of `main` stops
them becoming permanently discoverable and indexed; it does not make them secret. Deleting
that branch reduces discoverability further but does not guarantee removal, since
unreachable commits stay reachable by SHA for a time. The real remedy is closing the gaps,
not hiding the list.

The licence decision itself is emphatically public. A licensing promise that is not
published is not a promise.

## What survives from Track A

The relay is a small SaaS holding identity and ciphertext, so most of the cloud research
applies to it, re-scoped and much smaller:

| Doc | Fate |
|---|---|
| `01` current state | **Fully valid**, and held in `have-fish-ops` — see "What is public and what is private". |
| `02` data security | Held in `have-fish-ops`. §3 (input handling) and §7 (supply chain) apply **unchanged** in the local model; the rest is relay-scoped. |
| `03` compliance | PCI answer stands: we hold no cardholder data, and hosted-redirect checkout keeps us at SAQ A. Privacy obligations shrink to relay accounts and invitee emails. |
| `04` auth hardening | Applies to **relay accounts**. The local app has no login at all. |
| `05` billing | Applies **almost verbatim** — Better Auth's Stripe plugin, on the relay's accounts. |
| `06` infrastructure | Applies to the relay, which is far smaller than the service `06` imagined. |
| `07` observability | Same — plus a telemetry policy for the app itself (`L05` §6 recommends none, or opt-in crash reports only). |
| `08` launch readiness | Applies: terms, privacy policy, support channel, business entity, cost model. |

## What this direction adds that the cloud one didn't have

- **The localhost attack surface** (`L07` §1). Any webpage the user visits can fire
  requests at `127.0.0.1`. Host/Origin validation and a single-use token in the launch
  URL are required, not optional.
- **Update supply chain** (`L05` §4, `L07` §2). We ship executables; a compromised
  release is remote code execution on every user.
- **Code signing as a fixed cost** — roughly US$320/yr before anything is sold
  (`L05` §2).
- **The user's own backup hygiene becomes our UX problem** (`L02`): automatic local
  backup rotation, and restore as a first-run path rather than a support incident.

## Still open

| # | Question | Where |
|---|---|---|
| — | On linking, does the relay adopt the locally-generated `userId`, or is a rewrite needed? | `L01`, D2 |
| LQ1 | Is multi-currency settlement math stable under event reordering? | `L03` |
| LQ2 | Optional passphrase encryption of the local file | `L02`, D6 |
| Q1 | Target jurisdictions — Canada/US first, or accept EU users? | `03` |
| Q3 | Stripe direct vs merchant of record | `05` |
| Q5 | Sole proprietor or incorporate before holding others' data? | `08` |
| — | Mobile: LAN companion with an offline queue (`L08` O1) or true local peer (O2)? | `L08` |

## Code evidence for the boundary

Verified 2026-09-11 against the current codebase. These are the facts D2 rests on.

**The route partition is almost perfectly clean.** Of 19 route files: 10 are purely
personal (`accounts`, `transactions`, `postings`, `import`, `rules`, `parsers`,
`coverage`, `catch-up`, `reports`, `user-settings`), 8 are `fish-pie-*` (2,112 LOC), and
exactly one — `fx-rates` — straddles.

**The write path is completely FX-free.** `fxRates` is read in exactly two files:
`routes/fx-rates.ts` (the fetch-and-cache endpoint) and `routes/reports.ts` (display
conversion). Nothing in import, transactions, postings or healing reads a rate. The
single outbound `fetch()` in the whole backend is the frankfurter call at
`routes/fx-rates.ts:36`.

The reason is the data model: cross-currency transactions are stored as explicit
`equity:conversion` legs, so a Wise row balances per-commodity **without anyone knowing a
rate**. `postings/heal.ts` re-points postings at the conversion account and does no rate
arithmetic. This is the same property `epics/hledger-export.md` calls its key finding —
one design decision paying for export, offline writes and sync.

**The missing-rate UX already exists.** `GET /api/reports/spending-converted` uses cached
rates only, never fetches, and returns `{ total: null, missingCount }`.

**~1,420 LOC of domain logic is already database-free**, including the entire CSV import
pipeline (`csv-parser`, `dynamic-parser`, `merchant`, `import/postings`), plus
`account-type`, `roles`, `heal`, and every coverage interval calculation. What is coupled
is persistence and orchestration in the route handlers.

**The backend is barely tied to a server.** Six `process.env` references, all in
`index.ts`, `app.ts`, `auth.ts` and `db/index.ts` — none in any route handler.

**Postgres coupling is enumerable.** 15 raw `sql` templates, 3 of them portable check
constraints. The rest: `::date` casts (`coverage/load.ts:168`,
`routes/coverage.ts:111-113`), jsonb merge operators (`routes/user-settings.ts:103`,
`routes/coverage.ts:386-392`), and 3 `db.execute` raw queries
(`postings/heal-service.ts:93`, `routes/accounts.ts:364` and `:405`).

**No amount is ever summed in SQL** — only `count()` and `groupBy`, with amounts totalled
in JavaScript. This removes the main hazard of D8.

**The model is accidentally sync-friendly.** UUID primary keys let replicas create rows
without coordinating. Soft deletes everywhere mean deletions are ordinary writes —
tombstones you already have. `accountCoverage` is append-only merging intervals, which is
CRDT-shaped by accident. The Undo epic restores `deletedAt` to null, which is also just a
write, so it will not fight last-write-wins.

## Two obstacles the research did not have

**The frontend is served from the server, with an auth round trip per page.**
`frontend/src/hooks.server.ts` proxies `/api/*` **and** calls `/api/auth/get-session`
before rendering anything, so every page view costs a round trip before a byte of UI
appears — and offline it is a blank screen. Mitigating fact: that hook is the *only*
server-side code in the frontend (no `+server.ts` handlers, two load functions total), so
`adapter-node` → `adapter-static` per `L01` removes it cleanly. This is a latency win on
its own, today, independent of everything else.

**`updatedAt` is missing almost everywhere.** It exists only on `userSettings` and
`importRules`, plus the Better Auth tables. `accounts`, `transactions`, `postings`,
`csvParsers` and `accountCoverage` have `createdAt` and `deletedAt` but nothing recording
last modification. Last-write-wins merge needs it on every replicated table. Small,
independent, worth landing early.

**Import is where the boundary leaks**, and it is the offline killer app.
`backend/src/routes/import.ts` touches Fish Pie three times: preview reads
`importRules.groupId` and returns `suggestedGroupId`/`suggestedCategoryId`; commit accepts
`groupSplits` and validates group membership; duplicate detection joins
`groupSettlements`/`expenseGroups` to annotate rows with `fishPieGroupName`. Resolution
per D2: the annotation is cosmetic and drops offline; the other two degrade to a plain
expense with an unresolved-split flag. Refusing those rows instead would let one
shared-expense rule block an entire bank statement.

## Sequencing sketch (non-binding)

1. **Backups for the current deployment.** Unrelated to this plan and more urgent than it.
2. **Finish `epics/hledger-export.md` + CSV.** Delivers Vision principle #2 outright and
   makes every later decision reversible.
3. **`updatedAt` on every replicated table.** One small PR.
4. **Static frontend build target.** Removes the per-page auth round trip; a latency win
   today with or without the rest.
5. **The spike, as two cheap probes.** Linux only — that alone deletes the entire code
   signing problem (`L05` §2, ~US$320/yr): no Apple Developer account, no Authenticode,
   no notarization. Distribution is a file and `chmod +x`.
   - **Probe 1, no binary at all.** Translate the schema to `sqlite-core` on a branch and
     run the existing test suite against SQLite. The failure count *is* the estimate for
     the whole of `L02` Phase D2. This is where the weeks hide; Bun compiling is
     documented and boring by comparison.
   - **Probe 2.** Compile a Linux binary with the frontend embedded, boot it, and open a
     browser against real data.

   Sync and Fish Pie stay out of both. Working offline and merging back is the **last**
   capability to land, not the first — `L03` is 8–12 weeks on its own.
6. Everything else follows the phase breakdowns in `L01`, `L02`, `L03`.

Steps 1–4 ship real value even if this direction is abandoned entirely. That is deliberate.
