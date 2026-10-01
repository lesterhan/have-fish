# Desktop app on Electron

**Tracked as [#523](https://github.com/lesterhan/have-fish/issues/523)**, the parent, with
one sub-issue per story below. **Blocked by
[#522](https://github.com/lesterhan/have-fish/issues/522)**, the decision to rebuild at all;
the options it weighs, and the case against, live there and are not repeated here.

**Status: proposed** (2026-10-01). Nothing below is built until #522 closes on option 1,
except Story 1, which pays off under every option but a new repository.

The desktop app rebuilt from a fresh core: Electron, a TypeScript core over SQLite, and the
Svelte UI in a real window. It is built beside the current app in this repository, which
keeps running until the new one has earned its place. This epic is the first milestones: from
an empty directory to an app you can do a month's statements in. Parity with everything else
the current app does, and the cutover, are later epics.

## UX brief

- **Question this screen answers:** none new. Story 5's first-run choice is the only screen
  this epic adds; the rest are ported as they are.
- **Inbox role:** none.
- **Primary action + interaction count:** opening the app, one interaction: the menu entry
  opens a window, with no browser tab and no sign-in hand-off. Recording a transaction must
  take no more interactions than it does today; Story 4 counts both.
- **Case or work:** the case. The window frame becomes real: the Graphite titlebar is the
  window's titlebar, its buttons drive the window, and closing it quits. This is DESIGN.md
  §2's "the case must be honest" taken one step further than the browser could go.
- **Existing patterns reused:** all of them: `tokens.css`, `base.css`, the `ui/` components,
  `copy/`, the titlebar and status bar from `+layout.svelte`, and the account and transaction
  surfaces as they are.
- **Patterns being stretched or replaced:** the titlebar, from drawn to real (a drag region,
  and buttons wired to the window). SvelteKit's file routing gives way to a small client
  router; the pages themselves don't change.
- **What gets deleted:** in the new app, the browser tab, the launch-token hop, the sign-in
  and sign-up screens, and the in-page Quit that exists because a tab cannot stop a server.
  At cutover, a later epic deletes `backend/src/local/`, `frontend/` and the Bun binary.

## The stack

| Piece | Pick | Why |
|---|---|---|
| Shell | Electron | Main is Node, so the core runs in-process: no port, no sidecar. Chromium on Linux too |
| Database | SQLite, better-sqlite3 | One file (D8). Synchronous: a transaction never interleaves with another command |
| Queries, migrations | Drizzle, drizzle-kit | Already known; it has sync SQLite drivers, expo-sqlite included |
| UI | Svelte 5 + Vite | The components port; SvelteKit's server half has nothing to do here |
| Boundary | Zod | The renderer shows strings from bank CSVs and is the least trusted process |
| Tests | vitest on Electron's Node | `ELECTRON_RUN_AS_NODE=1`, so tests load the better-sqlite3 build that ships |
| Packaging | electron-builder | An AppImage artifact in CI now; the Flatpak from #518 at cutover |
| Format, lint | Biome, Prettier for `.svelte` | Unchanged; the root config covers the new directories |
| Packages | Bun | Already the repo's package manager and script runner. It no longer runs the app |

better-sqlite3's edge over libsql is simplicity, not correctness: libsql already keeps an
async transaction atomic, which is why D8 chose it over `bun:sqlite` (#284, #286). libsql stays
the fallback. It is N-API, so it needs no rebuild per Electron version, and Story 2 switches to
it if running better-sqlite3 under Electron's Node in CI fails.

## Layout

```
core/                 pure domain, shared: the current backend, this app, later the phone
desktop/
├── CLAUDE.md         which root conventions do not apply here, and what replaces them
├── main/
│   ├── db/           schema, client, migrations
│   ├── services/     *-service.ts: load, run a core rule, write
│   ├── commands/     the registry: one entry per command, its schema and handler
│   └── app.ts        window, single instance, protocol, lifecycle
├── preload/          the typed bridge
└── renderer/         Svelte 5 + Vite: tokens, components, copy, pages
```

The layers are today's, renamed where HTTP leaves: **domain** in `core/`, **services** in
`desktop/main/services`, and **commands** where routes were. `core/` imports only its package
allowlist. Services import the database and `core/`. Commands import services and Zod. The
renderer imports nothing from `main/`; it sees the bridge's types and no more. A layers test
holds each line, as `backend/src/layers.test.ts` does today.

Services stay in `desktop/main/` rather than `core/` because nothing else runs them yet. If
the phone ever holds a replica (#508 left that open), they move into a package then.

## The data model, taken on day one

These are the choices that are cheap now and expensive in a year, which is why they come
before any screen.

1. **One person per file.** No `userId` column anywhere. A `profile` row carries the identity
   sync will need. Scoping every query to a user, and the IDOR class of bug with it, goes
   away.
2. **Amounts are integer cents.** That's the same precision as today's `numeric(12,2)`, so the
   parity diff can be empty. A SQL `SUM` becomes exact, which retires the audit's F3 hazard
   (text amounts summing as doubles under SQLite). Services convert at the boundary with
   `core/money`; the domain keeps speaking decimal strings until there is a reason to change
   it. A per-currency scale (yen with no decimals, three-place dinars) is a separate question
   and is not taken here.
3. **Documents, per [`sync-unit.md`](sync-unit.md).** Roots carry `updatedAt` and
   `deletedAt`. Postings are replaced together with their transaction. Deletion is a tombstone.
   The import fingerprint is a column with its unique index.
4. **As the current SQLite schema has it:** UUID ids, UTC timestamps as integer milliseconds,
   and calendar dates as `YYYY-MM-DD` text.
5. **Nothing lost on the way in.** Ids come over unchanged from the current app.
   `groupExpenseId` is kept as opaque text the app doesn't read yet, because the Fish Pie
   client will need it and dropping it is not reversible.

## The boundary: commands, not routes

- **One registry**, `name → { input: ZodSchema, run(input) → Outcome }`. Main registers each
  entry with `ipcMain.handle`. The preload exposes `invoke(name, input)`, typed from the
  registry, so a renamed field is a build error on both sides.
- **Failures keep today's shape**, `{ error: CODE, detail }`. The codes live in a registry
  without HTTP statuses, and `copy/errors.ts` owns the words. The backend still writes no
  sentences.
- **The renderer's `api.ts` keeps its function names and signatures.** Commands replace
  `fetch` underneath, so ported pages keep calling the same functions.
- **The log gets one line per command**: name, duration, outcome code. Never the input; the
  `RequestLog` rule carries over. It goes to a file in the data directory, rotated as today.

## Security baseline

This is Story 2's work, not a later hardening pass:

- `contextIsolation` and `sandbox` on, `nodeIntegration` off.
- The renderer loads from an `app://` protocol, under a `default-src 'self'` CSP. No remote
  content. Navigation and new windows are denied.
- Every command's input is parsed by its schema, because the renderer shows strings that came
  from a bank's CSV.
- Single instance, and the data directory is the owner's alone (0700).
- No outbound network in these milestones. The opt-in FX lookup (#502) arrives later, in
  main, never in the renderer.

What leaves with the localhost server: the launch token, the Host/Origin check and the
lockfile handshake. No web page can reach IPC, so there is nothing for them to guard.

## Living beside the current app

- **Separate data.** The new app's ledger lives in `$XDG_DATA_HOME/havefish-next` until
  cutover, so neither app can open the other's file. The move to `havefish` is the cutover
  epic's job.
- **No releases yet.** The new app ships as CI artifacts only. `v*` tags stay the Bun
  binary's until cutover, and the Flatpak (#518) keeps installing the current app.
- **Which app is the truth.** Until Story 7 lands, the current app is, and Stage A's month
  (#254) runs on it. When this epic's gate starts, you bring the ledger over (Story 5) and the
  new app becomes where entry happens. The importer's insert-only re-run carries over whatever
  later stories add (parsers, rules, coverage) without touching what you entered.
- **The current app** gets fixes and the work already in flight (#502, the UX epics). Anything
  new that would only have to be ported again waits, unless you say otherwise.
- **Two sets of conventions.** `desktop/CLAUDE.md` says which root rules don't apply there:
  numeric-string amounts, `fail(c, …)`, `parseBody`, `userId` scoping, Postgres. The root
  `CLAUDE.md` gets one paragraph saying which directory follows which.

## Stories

### Story 1 — Move the pure domain into `core/` ([#524](https://github.com/lesterhan/have-fish/issues/524))

Move every module `layers.test.ts` already calls domain into a `core/` workspace package,
except `fish-pie/*` (it leaves with the service) and `mode.ts`. That is about 3,900 lines.
`errors.ts` splits: codes, `errorBody` and `Outcome` go to `core/`, and the status map stays
in the backend. The current backend imports from `core/`, so nothing changes for it. Both
suites stay green at the same counts, and `git log --follow` still reaches history from before
the move.

### Story 2 — Walking skeleton, M0 ([#525](https://github.com/lesterhan/have-fish/issues/525))

`desktop/` with main, preload and renderer, one command end to end, the real titlebar, the
data directory, migrations with a backup first and the refusal of newer files, the command
registry and log, the security baseline, and `desktop/CLAUDE.md`. CI type-checks, tests,
packages an AppImage and launches it under xvfb with Playwright's Electron driver. Done when
the CI artifact runs on your laptop.

### Story 3 — Ledger core, M1 ([#526](https://github.com/lesterhan/have-fish/issues/526))

The schema from "The data model, taken on day one", plus the services and commands for
accounts, transactions with postings, balances and settings. The behaviour assertions in the
backend's account and transaction tests are ported, without their HTTP or `userId` parts.
10,000 postings of 0.10 sum to exactly 1000.00 in SQL.

### Story 4 — Ledger screens, M1 ([#527](https://github.com/lesterhan/have-fish/issues/527))

Chrome, sidebar, accounts, the single account view, the transactions panel and the
transaction modal, ported rather than redesigned. Screens this epic doesn't build are absent,
not disabled. Recording a transaction takes no more interactions than today. DESIGN.md §9 is
run.

### Story 5 — Bring a ledger over, M2 ([#528](https://github.com/lesterhan/have-fish/issues/528))

A first-run choice, start empty or bring over your ledger, reading the current app's SQLite
file read-only. Ids are unchanged, amounts become cents, Fish Pie's own tables are skipped.
Insert-only by id, so it is safe to run again.

### Story 6 — hledger export and the parity diff, M2 ([#529](https://github.com/lesterhan/have-fish/issues/529))

Journal export from the new app, with `hledger check` in CI. `desktop/scripts/parity.ts`
exports one old-app file through both apps and diffs the journals. The formatter is shared, so
the diff tests everything around it: the schema, the cents conversion, the queries and the
importer. An empty diff on your real ledger is the gate's strongest check.

### Story 7 — CSV import, M3 ([#530](https://github.com/lesterhan/have-fish/issues/530))

Parsers, preview, duplicates and commit for every row kind `commit-plan` knows, plus the
multi-step import screens. The file is read in main, so the renderer only sees parsed rows.
Fish Pie splits are out. The import tests are ported, including the two time-zone runs.

### Story 8 — Import rules, M3 ([#531](https://github.com/lesterhan/have-fish/issues/531))

Stored rules, their suggestions in preview, and capturing a rule while categorising. It is its
own story because the gate is a real month, and a month without rules is categorised by hand.

## Gate

- A real month done in the new app: every statement imported, what needed fixing fixed, and
  the balances matching the bank.
- `hledger check` accepts its export.
- Your real ledger, brought over from the current app, exports the same journal from both, so
  the diff is empty.
- The packaged build from CI runs on your laptop.

## After this epic

Not scoped. Roughly in the order you're likely to miss them: FX rates and converted reports
(#502's work, ported), coverage and catch-up, heal, spending, settings and accent, undo. Then
the cutover epic: the Flatpak builds the new app, the data moves to `havefish`, and
`backend/`, `frontend/` and `backend/src/local/` are deleted. Sync (P4, #249) is built here,
not in the current app.

## Open questions

These are not decisions yet; each becomes a `type:decision` issue when something forces it.

- A per-currency scale for amounts.
- Whether services move into a shared package, which depends on the phone ever holding a
  replica (#508).
- The new app's name and app ID during the overlap, if it ever needs installing beside the
  current one rather than run from an artifact.
