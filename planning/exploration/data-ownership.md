# Exploration: Data ownership — a single-player app with a multiplayer server

Working doc. Started 2026-09-11, from a conversation with Lester while travelling in Asia
with the server at home in Canada.

**What this is:** the charter for how have-fish relates to its server, the boundary between
single-player and multiplayer, and the code evidence for why that boundary is real.

**What this is not:** stories, a schema, or a technology choice. The database question
(SQLite vs PGlite vs something else) and the vessel question (PWA vs desktop vs mobile) are
deliberately left open at the bottom. Everything above them holds regardless of the answer.

## What "data ownership" means here

Narrowed by Lester, 2026-09-11, and narrower than the phrase usually implies:

> You can get your financial data out at any time and use it elsewhere. Leave for pure
> spreadsheets — fine. Leave for another app that imports CSV — fine. Leave for hledger
> because you like double-entry and a CLI — fine.

Explicitly **not** part of it:

- **Fish Pie group metadata and spending summaries do not need to leave with you.** They are
  analysis and social bookkeeping. Once you have the ledger you can recompute or abandon
  them. (The *money* side of Fish Pie leaves anyway — settlements and splits write real
  transactions and postings into your own ledger.)
- **Encryption at rest is not a requirement.** The risk profile is deliberately modelled on
  hledger or a spreadsheet: a plaintext file on a disk you control. Transport is already
  covered by Tailscale. Volume-level encryption remains a free ops-side win, not an app
  concern.

Two things were added to the definition that aren't about export at all:

- **Autonomy.** Entering and reviewing your own finances is single-player. It should no more
  require a network than a save file requires one. A server in Canada answering a laptop in
  Asia is a per-click tax; a power cut at home should not stop you working.
- **Usability.** A non-technical user must not have to run a server. Install and forget, or a
  packaged application.

## The charter

1. **The personal ledger is single-player.** Reads, writes, computation and import never
   require the network.
2. **Fish Pie is multiplayer.** It requires the server, says so plainly, and is unavailable
   rather than quietly degraded.
3. **Where they meet, the personal side wins** and the shared part is deferred to a queue.
4. **Sync is automatic replication of the personal ledger between replicas.** It runs
   whenever the server is reachable, never blocks the UI, and is not a button the user
   presses. The server is the replica with an address and uptime — not an authority.
5. **The export serialization and the sync payload are the same format.** Export stops being
   a side feature and becomes the foundation everything else stands on.

### Decided: sync is automatic, not manual (2026-09-11)

The first instinct was deliberate sync — "multiplayer when I want it", by analogy with a
game's single-player save. That analogy breaks, because single-player saves never merge.

Long divergence windows are precisely what produce real conflicts: the same CSV imported
twice, the same account renamed differently on two devices, a transaction entered on the
phone and again on the laptop. Sync once a month and every one of those is waiting for you;
sync continuously and conflicts are seconds old and resolve themselves. Deliberate sync is
therefore the *harder* engineering problem, not the easier one.

What was actually being asked for is "never **wait** for the network" — and
automatic-when-reachable, non-blocking sync delivers that feeling without the divergence.
Settled in favour of automatic.

## Single-player / multiplayer, concretely

The mental model is a game: the binary is installed, not streamed; single-player runs the
engine locally against a local save; multiplayer is an outbound connection with visible
state; going offline greys out one menu rather than uninstalling the game.

### Three states

| State | Personal ledger | Fish Pie | Notes |
|---|---|---|---|
| **Never linked** | Fully functional | **Absent** | Fresh install, no account, no server. Don't render a permanently greyed-out tab for a feature this user will never use. |
| **Linked, online** | Fully functional | Live | Syncs in the background. |
| **Linked, offline** | Fully functional | Unavailable, or last-synced read-only | Pending-changes indicator somewhere honest. |

The distinction between "never linked" and "linked but offline" is a product decision, not a
technical one, and it is the one that makes the app usable by someone who never wants shared
expenses at all.

### The principle that keeps the boundary clean

> **The ledger is always writable. Agreements with other people need the server.**

Money movement is a fact about your own accounts — always recordable, always local. What a
movement *means* socially (this was a shared expense; this settled a debt) is an agreement,
and an agreement needs the other party.

So any single-player action that wants a multiplayer answer **records the money now and
queues the meaning for later**. Two worked examples:

- A bank row matches a split rule during an offline import → it imports as a plain expense,
  tagged unresolved, and surfaces later as something to finish.
- You hand your partner €40 cash in a market with no signal → you cannot record a
  *settlement*, but you can absolutely record €40 leaving your wallet and mark it as settling
  something, to be attached later.

This is very much in keeping with a double-entry app: the postings are the truth, the labels
are interpretation. The ledger never blocks; the categorisation defers.

## Where the boundary leaks

One place, and it is unfortunately the offline killer app: **import**.

`backend/src/routes/import.ts` touches Fish Pie three times:

1. Preview reads `importRules.groupId` and returns `suggestedGroupId` / `suggestedCategoryId`
   — split rules fire during matching.
2. Commit accepts `groupSplits` and validates group membership before writing.
3. Duplicate detection joins `groupSettlements` / `expenseGroups` to annotate matched rows
   with `fishPieGroupId` / `fishPieGroupName`.

Resolution: (3) is cosmetic — drop the annotation offline. (1) and (2) **degrade, they do not
block**: the row imports as a plain expense with an unresolved-split flag. The alternative,
refusing to import rows that match a split rule, lets one shared-expense rule block an entire
bank statement.

The deferral has a natural home in the vocabulary the app already has — the action-required
inbox and the catch-up coach are the same "here is something to finish later" pattern.

## What the codebase already gives us (verified 2026-09-11)

The cut turns out to follow a real joint in a codebase never designed for it.

**The route partition is almost perfectly clean.** Of 19 route files:

- **10 single-player, fully local:** `accounts`, `transactions`, `postings`, `import`,
  `rules`, `parsers`, `coverage`, `catch-up`, `reports`, `user-settings`.
- **8 multiplayer, server-only:** the `fish-pie-*` routes (2,112 LOC).
- **1 hybrid:** `fx-rates`.

**The write path is completely FX-free.** `fxRates` is read in exactly two files:
`routes/fx-rates.ts` (the fetch-and-cache endpoint itself) and `routes/reports.ts` (display
conversion). Nothing in import, transactions, postings or healing reads a rate. The single
outbound `fetch()` in the whole backend is the frankfurter call at `routes/fx-rates.ts:36`.

The reason is the data model: a cross-currency transaction is stored as explicit
`equity:conversion` legs, so the Wise row carries both amounts and the transaction balances
per-commodity **without anyone knowing a rate**. `postings/heal.ts` — the cross-currency
repair logic — is a pure function that re-points postings at the conversion account and does
no rate arithmetic at all. This is the same property `planning/epics/hledger-export.md`
calls its "Key finding". One design decision now paying off three times: export, offline
writes, and sync.

**The missing-rate UX already exists.** `GET /api/reports/spending-converted` uses DB-cached
rates only, never fetches, and returns `{ total: null, missingCount }`. A companion endpoint
reports which pairs are cached. Offline conversion display is therefore: replicate the rate
cache, top it up on sync, reuse the path that is already built.

**Roughly 1,420 LOC of domain logic is already database-free** and would run in a browser
today, unmodified:

```
pure:  import/csv-parser, import/dynamic-parser, import/merchant, import/postings,
       import/types, postings/account-type, postings/roles, postings/heal,
       coverage/intervals, coverage/months, coverage/catch-up,
       fish-pie-balance-service, currencies
db:    auth, coverage/horizon, coverage/load, postings/classify-service,
       postings/heal-service, fish-pie-accounts, fish-pie-expense-service
```

Notably the **entire CSV import pipeline** — parse, detect parser, normalise merchant,
propose postings — is pure. What is coupled is persistence and orchestration in the route
handlers, which is a much narrower problem than "port the backend".

**The backend is barely tied to a server at all.** 6 `process.env` references, all in
`index.ts`, `app.ts`, `auth.ts` and `db/index.ts` — none in any route handler. Hono is
runtime-agnostic; the 12k LOC test suite already drives the app via `app.request()` with no
socket.

**Postgres coupling is small and enumerable.** 15 raw `sql` templates, 3 of which are
portable check constraints in `schema.ts`. The rest: `::date` casts (`coverage/load.ts:168`,
`routes/coverage.ts:111-113`), jsonb merge operators (`routes/user-settings.ts:103`,
`routes/coverage.ts:386-392`), and 3 `db.execute` raw queries (`postings/heal-service.ts:93`,
`routes/accounts.ts:364` and `:405`).

**No amount is ever summed in SQL.** The only SQL aggregates are `count()` and `groupBy`;
every amount is totalled in JavaScript, and the house convention already treats amounts as
strings. This removes the main hazard of a dialect without a numeric type.

**The model is accidentally sync-friendly.** UUID primary keys mean replicas can create rows
without coordinating. Soft deletes everywhere mean deletions are ordinary writes — tombstones
you already have. `accountCoverage` is append-only merging intervals, which is CRDT-shaped by
accident and will survive any sync design. The Undo epic restores `deletedAt` to null, which
is also just a write, so it will not fight last-write-wins.

## What is in the way

**The frontend is served from the server, including an auth round trip per page.**
`frontend/src/hooks.server.ts` proxies `/api/*` **and** calls `/api/auth/get-session` before
rendering any page. So opening a page from Asia costs a Canada round trip before a byte of UI
appears, and offline it is a blank screen. The mitigating fact: that hook is the *only*
server-side code in the frontend — no `+server.ts` handlers anywhere and two load functions
in total. Removing it and switching `adapter-node` → `adapter-static` makes the frontend a
static bundle that can live on the device; the node build can stay as a second target for a
hosted flavour.

**`updatedAt` is missing almost everywhere.** It exists only on `userSettings` and
`importRules` (plus the Better Auth tables). `accounts`, `transactions`, `postings`,
`csvParsers` and `accountCoverage` have `createdAt` and `deletedAt` but nothing recording last
modification. Last-write-wins merge needs it on every replicated table. Small, independent,
and worth landing early whatever else is decided.

**Identity.** In single-player there is no login, but `userId` is threaded through every
table and every route, and Fish Pie needs a real identity to make you a member of a group.
**Linking to a server is the moment you acquire an identity** — and by then the local ledger
already has rows attributed to someone.

- Preferred: `userId` is `text`, so generate a UUID at first run and have the server **adopt**
  that id during linking rather than minting one. Nothing downstream needs rewriting. The
  open question is how hard Better Auth resists, since it wants to own signup and ids.
- Fallback: rewrite `userId` across every local row on link. Contained and one-time, but the
  kind of migration that should make you nervous in a finance app.

Nice property worth preserving either way: a partner's *multiplayer identity* lives on your
server, her *ledger* does not. Your box dies and she loses Fish Pie while keeping every
transaction she ever entered.

## Ruled out, with reasons

- **End-to-end encryption.** Would force every computation client-side as a side effect, make
  Fish Pie invites a key-exchange protocol, and turn a lost key into a lost ledger — to
  protect against a threat the stated risk profile (hledger file on a local disk) does not
  include. Volume-level encryption on the server is free and unrelated.
- **The journal file as the source of truth.** Purest expression of the ethos, but it cannot
  hold groups, invites, settlements, coverage assertions, parsers or rules, and has no answer
  for multiplayer at all.
- **Server-authoritative writes with a client outbox.** Keeps the server in the critical path,
  which contradicts the packaging requirement, and fails the actual travel use case: the thing
  you do on a plane is import a CSV, and that is a write.
- **Linking to more than one server**, and **peer-to-peer Fish Pie without a host.** Rabbit
  holes with no payoff for two people and a home server.

## Open questions

1. **The vessel.** PWA from static hosting (evictable storage — unacceptable as the only copy
   of a ledger), a packaged desktop app (durable, literally the "install and forget"
   requirement), or mobile (durable, and the existing Expo app is currently a thin online
   companion). This determines the database answer and whether desktop and mobile end up with
   two different availability models — which would move the chasm rather than close it.
2. **The local database.** SQLite everywhere (runs in every target including Expo; makes
   self-hosting a single file with no Postgres container; costs a `pg-core` → `sqlite-core`
   migration and the ~15 raw SQL snippets above) versus PGlite (zero schema change, days not
   weeks, but cannot run on React Native so it is a prototype rather than a destination).
3. **Better Auth and client-generated user ids** — see Identity above. Worth checking before
   anything else is committed to, because the fallback is a data migration.

## Cheapest next experiment

Before any of it: on the next trip, run the whole stack on the laptop. `podman compose up`,
point the browser at localhost, work locally for a week, then work out how to merge back. Zero
new code, and the merge-back being unsolved is the point — it measures how bad the conflict
problem actually is with real data instead of guessing.

## Sequencing sketch (non-binding)

1. Finish `hledger-export` + CSV. Already scoped, delivers Vision principle #2 outright, and
   makes every later decision reversible. Nothing should start before it.
2. Add `updatedAt` to every replicated table. One small PR, unblocks everything.
3. Answer open question 3 (Better Auth / client ids) with a spike, because the fallback is
   expensive.
4. Static frontend build target — removes the per-page auth round trip and is a latency win on
   its own, today, with or without local-first.
5. Everything else waits on open questions 1 and 2.

Steps 1, 2 and 4 ship real value even if local-first is abandoned entirely. That is deliberate.
