# 00 — Direction: what we are building and why

**Status:** Decision record. **Read this first.** Started 2026-09-11.

This document is the single source of truth for the productionization direction. The
numbered documents (`01`–`08`) and the `local-first/` documents (`L01`–`L08`) are
**research**, dated 2026-07-04 and still accurate as research. Where they present an
open choice that has since been decided, this document is what holds. Where they
describe how something works, they hold.

The two-track framing in the old `README.md` — cloud SaaS versus local-first, decide
later — is **resolved**. See D1.

**The audit that amends this document.** `audits/2026-09-architecture-audit.md` in the
private [`lesterhan/have-fish-ops`](https://github.com/lesterhan/have-fish-ops) repository
reviews every decision below, decision by decision, and is the source of everything here
dated **2026-09-21**. Its findings are cited inline as `F1`–`F10`. Read it alongside this
document; a session that has not read it will re-derive its conclusions badly.

## The product, in a paragraph

have-fish is a personal finance tracker you install on your machine. Your ledger lives
in a file you own, and the app works completely without a network — entering, importing,
reporting, reconciling. It is free. Optionally you can pay for a sync service that
replicates your ledger between your own devices and powers Fish Pie, the shared-expense
feature, with other people.

The sync service relays ciphertext, and it is worth being exact about which half is which.
**Encrypted before it leaves your machine, unreadable by the service:** amounts,
descriptions, account names and paths, member names, and every transaction and posting.
**Readable by the service, because routing and billing need it:** your account and email
address, the email addresses of people you invite, who shares a group with whom, when you
sync, and how large each message is. A breach leaks the second list, not the first.

If you stop paying, or we disappear, the app and every transaction in it keep working.

## Decisions

### D1 — Local-first executable, free; sync and multiplayer as a paid subscription
**2026-09-11. Resolves LQ4 (Track A vs B vs both) and L06's model question.**

We are not building a cloud service that holds other people's ledgers. Track A
(documents `01`–`08`) is **superseded as a product direction**, and survives as research
for the relay, which is a miniature version of it — see "What survives from Track A".

**The driver is ownership and sellability, not latency** (2026-09-21, `F1`). Most of the
slowness and downtime that motivated this direction has a weekend fix on the hosted
edition — a restart policy, and a static frontend build that deletes the per-page auth
round trip — and is being fixed there first. Local-first is worth six months of evenings
because the ledger should belong to the person who wrote it, and because a free app with
paid sync is a thing someone can buy. It is not worth them as a way to make a page load
faster. Naming the real driver changes what "done" means: not a quicker render, but a
ledger that does not depend on a server at all.

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

**Stated precisely (2026-09-21, `F8`): the MIT promise is kept by choice, not by law.**
Anything already released under MIT stays MIT and cannot be recalled — that much is
settled. But `LICENSE` has a single copyright holder and no third-party human
contributors, so nothing prevents *future* versions being released under different terms.
The promise above is a commitment, not a legal impossibility. It is worth more said
honestly than overstated, because the claim it supports is a claim about trust.

**The name is not part of the grant.** The MIT licence covers the code. "have-fish", "Fish
Pie" and the logo are not licensed with it. Fork the code freely — that is the
self-hosting escape hatch working exactly as D1 intends — but a fork that points its users
at a different relay should carry a different name, so that someone who trusts the name
can tell what they are connecting to.

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
   you cannot audit my server, but you can audit the client that encrypts before it sends,
   and see for yourself that no ledger content leaves in the clear. Not that the server
   learns nothing — it learns who you are and who you share with, as the product paragraph
   above sets out. The licence split and D6 hold each other up.

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

**Amended 2026-09-21 (`F4`): this is the *whole* of relay v1.** The relay replicates the
personal ledger only, under a single per-user key. Group replication is a separate
product and a separate decision, deferred until a Fish Pie group exists that is not one
household. Until then Fish Pie runs on the hosted edition exactly as it does today — see
D9.

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

**Amended 2026-09-21 (`F4`): the cheap half ships, the expensive half waits.** Personal
replication needs one symmetric key per user — passphrase-derived or keychain-held, with
no exchange, no rotation and no recovery protocol — and is days of work. Group sync needs
per-group keys, sealed invites, rotation and re-encryption every time a member leaves, and
an answer for a member who loses their key; `L03` budgets 2–3 weeks for that and the audit
calls the estimate optimistic. Relay v1 ships the first only. The second is decided when
there is a group to decide it for, and until then group data stays plaintext on the hosted
edition — a deliberate trade, made with the household in mind, not an oversight.

Either way the relay sees account and invitee email addresses, the membership graph, sync
timing and message sizes. That is why the paragraph at the top of this document lists what
is ciphertext and what is not, instead of claiming the service sees nothing.

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

**Amended 2026-09-21 (`F5`): gate it on the hosted edition, which exists.** Gating Fish
Pie on the relay makes it unavailable for the 8–12 weeks the relay takes to build. It runs
on the hosted edition today, so that is the gate. Which forces the thing this plan has
been avoiding saying:

> **The hosted edition is a permanent deployment target, not a transition artifact.**

It is what the household runs, what anyone who tries have-fish without installing a binary
will run, and what Fish Pie runs on for at least a year. `HAVEFISH_MODE=server` therefore
has to stay real, and "we'll delete it after the migration" is not a plan anyone should
budget against.

Admitting that opens a dialect question with three answers: one dialect everywhere,
Postgres on the host with SQLite in the binary, or a dual-dialect matrix maintained
forever. The third is the worst of the three and the one this plan drifts into by never
choosing. **The choice is deferred to Probe 1 (D8) and is owed explicitly** — it is a
decision to be made with measurements in hand, not a default to be inherited. Whichever
way it lands, it gets written down here as a decision rather than discovered later as an
accident.

### D10 — Export scope, and why export is **not** the sync format
**2026-09-11.**

What must be able to leave: accounts, transactions, postings — enough to walk away to
hledger, a spreadsheet, or another app. Fish Pie group metadata and spending summaries
are analysis and social bookkeeping; they do not need to leave, because you can recompute
them once you have the ledger. The money side of Fish Pie leaves anyway, since
settlements and splits write real transactions and postings into your own ledger.

**Corrected 2026-09-21 (`F6`): these are two formats, and conflating them was a
contradiction inside this decision.** The hledger journal is lossy on purpose — it carries
no UUIDs, no tombstones, no `accountCoverage` intervals, no `importRules`, no
`csvParsers`, no preferences, no `groupExpenseId` links and no settlement FX. A replica
bootstrapped from a journal would lose every import rule and parser and re-flag every
account as uncovered. It is not your ledger, which is precisely what D5 promises to put on
every device.

So: **sync replicates versioned documents** (the `{transaction, postings[]}` unit of
`F2`), and **bootstrap is the encrypted database file**. Export stays exactly as
`epics/hledger-export.md` scopes it — one-directional, lossy, and the escape hatch that
Vision principle #2 promises. Keeping them separate costs nothing today and stops the sync
payload being designed around a format that cannot carry it.

## Do these now, regardless of everything above

From `01`, audited 2026-07-04. These affect the deployment that exists today, not the one
being planned. Revised 2026-09-21: item 1 is done, and the old item 2 was dropped as work
for a product this document supersedes — both noted below rather than silently edited out,
because a list like this is only useful if you can see what left it and why.

1. ~~**There are no backups.**~~ **Done 2026-09-21** (#272, #365). Nightly dump, offsite
   restic repository, retention that actually expires, root-only dump permissions, a
   restore check that compares every table, and an off-machine restore rehearsed from a
   laptop against the real repository. One piece is outstanding: a deliberate failure that
   produces a notification actually received. The failure hook is wired and waits on a
   ping URL.
2. ~~**Postgres is published on host port 8886**~~ — removed 2026-09-21 (#274); it now
   listens only on the Compose network. Still open: containers run as **root**, and there
   is no rate limiting on any application route.
3. **The per-route IDOR audit has never been done.** Tests were written for correctness,
   not for adversarial access, and Fish Pie is genuinely multi-user today.
4. **CI has no dependency audit, secret scanning or image scanning.**

**Removed 2026-09-21 (`F10`): "no password reset and no email transport".** That was table
stakes for the public SaaS this document supersedes in D1. Under the direction actually
chosen, the local application has no login at all, and the hosted edition has two users
whose passwords can be reset directly in the database. Password reset, email transport and
`emailVerified` are **relay concerns** — they belong to relay accounts, in whatever shape
the relay ends up needing, and `04-auth-hardening.md` is already re-scoped that way. An
evening spent wiring an email provider now is an evening spent building it twice.

The trigger that reopens both this and item 3 is the same one: a person outside the
household getting an account on the hosted edition.

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
| — | Group end-to-end encryption: per-group keys, rotation, recovery. Deferred 2026-09-21 until a Fish Pie group exists outside the household | D6, `F4` |
| — | Dialect for the hosted edition: one everywhere, split, or a dual matrix. Deferred 2026-09-21 to Probe 1; owed explicitly, not by default | D8, D9, `F5` |
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

**Amounts are summed in SQL in two places.** Corrected 2026-09-21 (`F3`); this document
previously claimed no amount was ever summed in SQL, which made D8 look cheaper than it
is. `routes/accounts.ts:185` and `:297` both run `SUM(${postings.amount})`. Everywhere
else totals in JavaScript — though not innocently, since those totals go through
`parseFloat`/`toFixed`. Under SQLite a `numeric()` column in `sqlite-core` takes NUMERIC
affinity and text amounts sum as doubles, so both sites are port work that has to be
counted, not a hazard that was already absent.

**The model is partly sync-friendly, and one part of it is actively hostile.** UUID
primary keys let replicas create rows without coordinating. `accountCoverage` is
append-only merging intervals, which is CRDT-shaped by accident. The Undo epic restores
`deletedAt` to null, which is an ordinary write and will not fight last-write-wins.

**But "soft deletes everywhere" is wrong**, corrected 2026-09-21 (`F2`).
`routes/transactions.ts:444` and `:483` **hard-delete every posting** on update and on
delete, then re-insert with fresh UUIDs. Splits, weights and invites are hard-deleted too
(`fish-pie-expenses.ts`, `fish-pie-categories.ts`, `fish-pie-invites.ts`). So posting
identity is not stable across an edit, and the rows that vanish leave no tombstone.
Row-level last-write-wins on `postings` would keep one device's edited row *and* another
device's replacement set, and produce a transaction that does not balance — found months
later, reconciling a bank statement.

This is why the sync unit is the **transaction, not the row**: replicate
`{transaction, postings[]}` as one versioned document, with `updatedAt` on `transactions`
only. The same shape applies to `{expense, splits[]}` and to settlement batches, which are
already grouped by `batchId`. Step 3 of the sequencing sketch below was written against
the wrong table and should be read with this correction in hand.

## Two obstacles the research did not have

**~~The frontend is served from the server, with an auth round trip per page.~~**
**Resolved 2026-09-22 (#275).** `hooks.server.ts` proxied `/api/*` **and** called
`/api/auth/get-session` before rendering anything, so every page view cost a round trip
before a byte of UI appeared — and offline it was a blank screen. It turned out to be
smaller than it looked: the hook fed two redirect gates and nothing else, and the chrome
already had its own client-side session through Better Auth's `useSession()`. So the
client already knew what the server was re-deriving on every request.

The frontend is now `adapter-static` with the guards in the browser, and the backend
serves the build from one origin — no proxy hop, no CORS in production, one container
instead of two. That last part is also the shape D7 needs: one process binding a port and
handing out the same assets is what the local binary does, so P2.3 inherits it rather than
rebuilding it.

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

1. ~~**Backups for the current deployment.**~~ **Done 2026-09-21.** Unrelated to this
   plan and more urgent than it, which is why it went first.
2. **Finish `epics/hledger-export.md` + CSV.** Delivers Vision principle #2 outright and
   makes every later decision reversible.
3. **`updatedAt` on every replicated document root** — `transactions`, expenses and
   settlement batches. *Not* on `postings` or splits, whose identity is not stable across
   an edit (`F2`, and the correction under "Code evidence" above). Still one small PR, but
   design the sync unit before writing it, or it lands on the wrong tables.
4. ~~**Static frontend build target.**~~ **Done 2026-09-22** (#275). Removed the per-page
   auth round trip, and collapsed the two containers into one — a latency win today, and
   the serving shape P2.3 needs.
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
