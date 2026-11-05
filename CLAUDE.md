# have-fish 有鱼

Personal finance tracker. Tracks accounts, transactions, budgets, and projects spending over time.
Today it runs self-hosted on a home server (Docker/Podman + Tailscale); it is becoming a
local-first desktop app with the ledger in one file on the user's machine.

## Vision

Three guiding principles that should inform every feature decision:

1. **No bank connections** — transactions are entered manually or imported from a bank-exported CSV. Never OAuth to a financial institution, never a third-party sync service.

2. **Portable data** — the system must be able to export all data to an [hledger](https://hledger.org/)-compatible `.journal` file. This is the escape hatch: if the server is lost or the user moves to another tool, nothing is trapped.

3. **Multi-currency as a first-class concern** — the user travels and holds balances in multiple currencies. Currency, exchange rates, and cross-currency reporting are core workflows, not edge cases.

## Held to on every change

Four requirements come before any feature. A change that costs one says so in its PR, with the
reason, and every review checks all four. When two pull against each other, the earlier one
wins: a slow screen can be fixed later, a lost transaction can't. They are written for the
rewrite; a fix to the current app keeps to them too.

1. **Data integrity.** A transaction once saved is never lost, half-written or quietly changed.
   The file is crash-safe (WAL, `synchronous = FULL`), a document is applied whole in one
   transaction, a file with data is copied before it is migrated, and a file the app didn't
   write, or a newer build did, is refused and left as it was. Tests pin each of these. Review
   watches for:
   - a write outside a transaction, or a document written in parts;
   - a pragma relaxed, or the ledger copied with `fs` rather than through SQLite;
   - a migration that no test runs against a file with data in it;
   - a write to a document's rows that skips `desktop/main/ledger/`, which keeps the versions,
     tombstones and outbox;
   - a rule the ledger relies on that only the window checks.
2. **Security.** The baseline in `planning/desktop-rewrite.md`, "Security baseline", holds on
   every change, and the tests that pin it stay. Review watches for:
   - text from a bank file or the ledger reaching the page as HTML (`{@html}`, `innerHTML`);
   - a way into main other than a command, or a command whose input skips its schema;
   - anything loaded from the network;
   - a new dependency, which runs with the ledger in reach.
3. **Privacy.** The ledger is the user's alone. Nothing leaves the machine unless they send it:
   no telemetry, analytics or crash reports, and the app works with the network off. The app's
   folders and files are readable by the user alone. Review watches for:
   - a request the user didn't ask for, or a dependency that makes one;
   - an input, an amount or a description in a log line or a file name;
   - a file written outside the app's folders, or without owner-only permissions;
   - a temporary copy of ledger data left behind.
4. **Performance.** The app stays fast with ten years of ledger in it: about 50,000
   transactions and 100,000 postings. Speed is judged on that ledger, never on an empty one;
   the numbers are in `planning/desktop-rewrite.md`, "Performance". Electron was kept on this
   condition. Review watches for:
   - work that grows with the ledger on a path that runs per change or per keystroke: a query
     with no limit, a whole list reloaded, a sum or sort in TypeScript that SQL could do;
   - a query without its index (a full scan or `USE TEMP B-TREE` in `EXPLAIN QUERY PLAN`);
   - a long list drawn whole instead of windowed;
   - slow work on Electron's main process, which every command and the window wait behind;
   - weight added to start-up: a dependency, or work done before the window shows.

## Two apps, one repository

The app is being rebuilt as a desktop app beside the current one: Electron, a TypeScript core
over one SQLite file, and the Svelte UI in a real window. This was decided in #522 on
2026-10-04, and the plan is `planning/desktop-rewrite.md`.

| | Current app | Rewrite |
|---|---|---|
| Folders | `backend/`, `frontend/`, `mobile/` | `core/`, `desktop/` |
| Role | The real ledger, until the rewrite replaces it | Built one story at a time; no releases yet |
| Takes | Fixes, and the work already in flight | New features, as stories |
| Its rules | A `CLAUDE.md` in each of its folders | This file, "The rewrite" |

The current app's rules live in `backend/CLAUDE.md`, `frontend/CLAUDE.md` and
`mobile/CLAUDE.md`. Claude Code loads each one when a session first reads a file in that folder,
so rewrite work meets them only when it reads current-app code, as a port does. There they
describe the code being ported from, not the code being written. A current-app change that
spans folders reads each one it touches before planning.

```
have-fish/
├── backend/          # current app: Hono + Bun API over Postgres or SQLite
├── frontend/         # current app: SvelteKit + Svelte 5
├── mobile/           # current app: React Native + Expo, Android
├── core/             # rewrite: the pure domain
├── desktop/          # rewrite: Electron main, preload and renderer (its main/db/ first)
├── planning/         # desktop-rewrite.md, and QA fixtures
├── DESIGN.md         # the rewrite's design (the current app's is frontend/DESIGN.md)
└── biome.jsonc       # one formatter and linter for the whole repository
```

## The rewrite

It is built one piece at a time, foundations first. Until a rule lands here,
`planning/desktop-rewrite.md` is the authority. Already decided:

- **`core/` is pure TypeScript.** It imports only `zod` and its own files: no database, no
  Electron, no I/O, and no clock. A function that needs the time takes `now` as a parameter.
- **Tests run on vitest**, never `bun:test`. In `desktop/` they run on Electron's Node
  (`ELECTRON_RUN_AS_NODE=1`), so they load the better-sqlite3 build that ships. Every step
  starts with a failing test.
- **The ledger is documents**: a transaction with all of its postings, or an account, applied
  whole. Ids are UUIDs. Deletion leaves a tombstone (`deletedAt`) rather than a gap.
- **Amounts** are integer cents in the ledger file, and documents carry them as canonical
  decimal strings (`"-12.50"`). A float never holds money.
- **Dates** are calendar-day text (`YYYY-MM-DD`). Timestamps are UTC.
- **One person per file**, so nothing carries a `userId`.
- **Commands, not routes.** Each one has a Zod schema and a handler. A failure keeps today's
  shape, `{ error: CODE, detail }`, and the words stay in the UI's copy, so the core writes no
  sentences.
- **Every word the app shows is in `desktop/copy/`**, one file per surface, read by main and
  the window through one `copy` object. `desktop/copy/copy.test.ts` fails on a word typed
  anywhere else and on a component reading a key that isn't there, and every failure code
  must have words or `bun run check` fails. The web app's four copy rules hold
  (`frontend/CLAUDE.md`, "Copy"), and there is no i18n library.
- **Port by copying or rewriting, never by moving.** The current backend keeps its own copy,
  untouched.
- **The security baseline** comes with the first story, not later: `planning/desktop-rewrite.md`,
  "Security baseline".

None of the current app's server machinery carries over: Postgres and the two-dialect schema,
Hono and `app.request` tests, Better Auth, `userId` scoping, `numeric(12,2)` strings. Biome,
Prettier and the copy rules do. The current app's look does not: the rewrite's UI system is
`DESIGN.md`, "The system", built from the parts it lists, and a screen not yet moved onto it
stays plain.

## Formatting and linting

```bash
# From the project root
bun run check         # format check + lint + import order, the same gate CI runs
bun run check:fix     # apply every safe fix
bun run format        # formatting only
# The same thing from inside a package, scoped to it. `check` is already taken there by the
# type checker, so the script is called `lint`:
bun run lint
```

One formatter and one linter span the whole repository: **Biome**, configured in `biome.jsonc` at
the root. Running it from a package picks up the same root config and only that package's files,
so there is one answer to what the code should look like and one command that gives it. CI runs
`bun run check` on every pull request; warnings do not fail the job, errors do.

The one exception is `.svelte` files, which Biome cannot format — **Prettier** still owns those
and nothing else.

Two settings are deliberately not Biome's defaults, and both are there so the tool agrees with
the code that already exists rather than rewriting it: single quotes and no semicolons in
TypeScript, single quotes in CSS too (the frontend's Prettier config has said so since the
beginning, and the token tests read `tokens.css` as text), and a 100-column line (the default 80
would rewrap roughly a tenth of the repository to no purpose).

`.git-blame-ignore-revs` holds the one-time reformatting commit. Configure git to skip it with
`git config blame.ignoreRevsFile .git-blame-ignore-revs`; GitHub reads the file automatically.

## Design

Each app has one design document, and it is the source of truth for that app's UI. Read it
before any work that touches the UI.

- **`DESIGN.md`** at the root is the rewrite's: three priorities (speed and reliability, clarity,
  delight), how to build screens until its UI system lands, what being a desktop app asks, and
  the rules for themes. It grows only when something is built on it, and a rule lives in a test
  wherever it can.
- **`frontend/DESIGN.md`** is the current app's, and it is in maintenance: a fix keeps to it, and
  nothing new extends it. It retires with that app. Its implementation reminders are in
  `frontend/CLAUDE.md`.

## Working on the code

- **Tests prevent regression.** The hosted app is a real ledger until the rewrite replaces it.
  Write comprehensive tests for every new route and behaviour; in the rewrite, every step starts
  with a failing test. Tests are not an afterthought.
- **PRs, not direct pushes.** All work goes through a branch and a pull request opened against
  `main`. Never push directly to `main`. This is the gate that keeps the deployed app stable.
- **Explain non-obvious decisions.** When you make a choice the conventions don't dictate (data
  model trade-offs, architectural decisions, security choices), say so briefly in the PR.
- **Comments are short.** One line where one line does it: what the code is for, or why it is
  this way when the code can't show that. Background, history and reasoning go in the PR body,
  and the comment cites the PR (`see #548`) when the reader will want it. A comment says a
  rule's reason in a sentence, not a paragraph. For example:

  ```ts
  // `max` stops time going backwards; the counter keeps the order.
  ```

## PR workflow

### Naming

Uniform titles and branches: the branch leads with the work's key, the title doesn't.

**PR title** — `[scope] Imperative description`

```
[core]          Add the ledger documents and their checks
[trust-signals] Story 2 — rollup tiles carry their as-of
[mobile-cash]   Fix keyboard overlap on bottom sheets
[accounts]      Fix the tab strip, which ignored clicks
[repo]          Add a pull request template
```

- **scope** is the epic slug when the work belongs to a current-app epic, otherwise the surface
  or area in one word (`core`, `desktop`, `accounts`, `import`, `mobile`, `design`, `repo`, `ci`).
- A current-app epic's stories carry `Story N — ` after the scope, matching the story numbers in
  the epic file. One story per PR.
- Imperative mood, no trailing full stop, ~70 characters so GitHub's list view doesn't truncate
  it.

**Branch** — `<key>/<short-description>`

```
core-3/open-ledger-file
entry-1/write-down-spend
trust-signals-2/rollup-as-of
issue-282/expense-labels
```

- **key** is the work item's key, lowercased (`Core-3` → `core-3`). A current-app epic's story is
  its slug and story number (`trust-signals-2`); a GitHub issue is `issue-N`.
- **description** is two or three words, hyphenated — enough to recognise in `git branch`, not
  the whole title.
- No author prefix: the key says what it is, and the PR says who.

Branches created by Claude Code on the web are named by the harness and cannot follow this; the
title convention is what holds in every case.

**Body** — `.github/pull_request_template.md` is the shape, and short enough to read on a phone.
A rewrite PR has a Worth your read section.

### Normal feature flow

```bash
# 1. branch off main
git checkout -b <key>/<short-description>

# 2. implement, commit
git push -u origin <key>/<short-description>

# 3. open the PR on GitHub, titled [scope] Description, body from the template
# 4. review, iterate, merge on GitHub

# 5. sync local main after merge
git checkout main
git pull origin main
```

## The maintainer's conventions

The maintainer keeps their own way of working with Claude (the backlog, the modes, the skills,
how sessions report back) in a private repository. Where it is cloned beside this one, it loads
here; anywhere else this line loads nothing:

@../have-fish-vault/.claude/workspace.md
