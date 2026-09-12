# have-fish 有鱼

Personal finance tracker. Tracks accounts, transactions, budgets, and projects spending over time.
Built for self-hosting on a home server (Docker/Podman + Tailscale).

## Vision

Three guiding principles that should inform every feature decision:

1. **No bank connections** — transactions are entered manually or imported from a bank-exported CSV. Never OAuth to a financial institution, never a third-party sync service.

2. **Portable data** — the system must be able to export all data to an [hledger](https://hledger.org/)-compatible `.journal` file. This is the escape hatch: if the server is lost or the user moves to another tool, nothing is trapped.

3. **Multi-currency as a first-class concern** — the user travels and holds balances in multiple currencies. Currency, exchange rates, and cross-currency reporting are core workflows, not edge cases.

## Stack

- **Backend**: Hono + Bun (TypeScript)
- **Frontend**: SvelteKit + Svelte 5 (TypeScript)
- **Mobile**: React Native + Expo (Android, `mobile/`)
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: Better Auth (email + password)
- **Deployment**: Docker/Podman Compose

## Project Structure

```
have-fish/
├── backend/
│   ├── src/
│   │   ├── app.ts           # Hono app (import this in tests)
│   │   ├── index.ts         # Bun server entry point (do not import in tests)
│   │   ├── db/
│   │   │   ├── schema.ts    # Drizzle schema — source of truth for DB shape
│   │   │   └── index.ts     # Drizzle client
│   │   ├── routes/          # One file per resource, co-located with tests
│   │   └── test-utils.ts    # clearDatabase() helper for tests
│   └── drizzle/             # Generated migration files (do not edit by hand)
├── frontend/
│   └── src/
│       ├── styles/
│       │   ├── tokens.css   # Design tokens — single source of truth for all visual values
│       │   └── base.css     # Global reset and baseline typography
│       ├── routes/          # SvelteKit file-based routing
│       └── lib/
│           ├── components/  # Reusable Svelte components
│           └── api.ts       # Typed fetch helpers for the backend
└── mobile/
    ├── app/                 # Expo Router file-based routes
    │   ├── (auth)/          # Login screen
    │   └── (app)/           # Authenticated screens (groups, settings)
    ├── components/          # Shared React Native components
    ├── lib/
    │   ├── api.ts           # Typed fetch helpers — base URL + session pulled from SecureStore
    │   └── auth.ts          # Session + server base URL stored in SecureStore
    ├── plugins/             # Expo config plugins applied during prebuild (e.g. release signing)
    └── app.json             # Expo config (package: com.lesterhan.havefish)
```

## Key Commands

```bash
# Backend (run from /backend)
bun run dev           # start dev server with hot reload
bun test              # run all tests
bun run test:watch    # run tests in watch mode (use while developing)
bun run db:generate       # generate SQL migrations from schema changes
bun run db:migrate        # apply migrations to the dev database
bun run db:migrate:test   # apply migrations to the test database
bun run db:studio         # open Drizzle Studio (DB GUI in browser)

# Frontend (run from /frontend)
bun run dev           # start dev server
bun run build         # production build
bun run check         # TypeScript + Svelte type checking

# Mobile (run from /mobile)
bun run start         # start Metro bundler (scan QR with Expo Go)
bun run android       # run on connected device / emulator (needs Android SDK)
# Signed release APKs are built in CI (.github/workflows/build-android.yml) and
# published as GitHub Releases for Obtainium. Cut a v* tag to trigger a build.
# See mobile/README.md for the local prebuild + gradle assembleRelease flow.

# Infrastructure (run from project root)
podman compose up postgres -d     # start just Postgres locally
podman compose up --build         # start full stack
```

## Development Workflow

- Write tests first in `*.test.ts` co-located with the route file
- Tests use `app.request()` (Hono's test helper) against a real database — no mocking
- Always run `clearDatabase()` in `beforeEach` to keep tests isolated
- Tests run against `havefish_test` (set via `TEST_DATABASE_URL`); the dev database (`havefish`) is never touched by the test suite
- After changing `schema.ts`, run `db:generate` then **both** `db:migrate` and `db:migrate:test`

## Environment

Copy `.env.example` to `.env` in the backend directory for local dev:
```
DATABASE_URL=postgres://havefish:havefish@localhost:5432/havefish
TEST_DATABASE_URL=postgres://havefish:havefish@localhost:5432/havefish_test
PORT=8887
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:8887
FRONTEND_URL=http://localhost:8888
```

`DATABASE_URL` is the dev database. `TEST_DATABASE_URL` is a separate database used exclusively by the test suite — `bun test` sets `NODE_ENV=test` automatically, which makes the DB client pick `TEST_DATABASE_URL` instead. The test database must be created and migrated once: `bun run db:migrate:test`.

## Design System

**`DESIGN.md` is the single source of truth for design** — the aesthetic, the token
vocabulary, UX principles, interaction laws, the rules for reusing vs. replacing
components, and the process for evolving the UI. Read it before any epic that touches
the UI.

Implementation reminders that belong with the build instructions:

- `frontend/src/styles/tokens.css` holds every visual value. Never hard-code a colour,
  space, radius, or shadow — always a token.
- `frontend/src/styles/base.css` is the global reset and baseline typography. Both are
  imported once in `+layout.svelte`.
- CSS variables in scoped `<style>` blocks inside `.svelte` files. No CSS framework.
- One component per file under `frontend/src/lib/components/`.

```svelte
<script lang="ts">
  interface Props {
    // typed props here
  }
  let { ... }: Props = $props()
</script>

<!-- markup -->

<style>
  /* scoped styles using token variables only */
  .example {
    padding: var(--sp-sm) var(--sp-md);
    color: var(--color-text);
    background: var(--color-window);
    box-shadow: var(--shadow-control);
    font-size: var(--text-sm);
    transition: box-shadow var(--duration-fast) var(--ease);
  }
</style>
```

## Copy

User-facing strings live in `frontend/src/lib/copy/`, one file per surface, imported as a
namespace: `import { copy } from '$lib/copy'`, then `copy.auth.signIn.title`. This is being
rolled out surface by surface (`planning/epics/copy-extraction.md`); a file that has been
converted is listed in `CONVERTED` in `copy.test.ts`, and that test fails if a hardcoded
string reappears in it.

Four rules, and the first is the one that matters:

- **A message owns its whole sentence.** Never build prose at the call site out of two copy
  keys and a conditional. `${n} transaction${n === 1 ? '' : 's'}` is not a message; it is a
  splice. Use `plural(n, one, other)` from `$lib/copy` so both readings sit in the copy file
  as prose. Adjacent independent phrases — a question next to a link's label — are fine.
- **Parameters are named and typed.** A message that varies is a function, so a renamed
  argument is a build error instead of `undefined` on screen.
- **Formatted data is not copy.** Amounts, dates and percentages go through the `money` and
  `date` helpers and `Intl`. A currency symbol in a copy file is a multi-currency bug.
- **One file per surface**, added by the story that converts it, and added to `CONVERTED`
  in the same PR.

No i18n library, no `en/` folder implying a sibling — a typed object is the whole design.

## Work Tracking

Work is tracked as **GitHub Issues**, viewed on one **GitHub Project** (`have-fish`, owned by
the `lesterhan` user) that spans this repo, the private `lesterhan/have-fish-ops`, and the
server repo when it exists. The full guide, label set and board setup live in
`have-fish-ops/tracking/README.md`; the reasoning behind the backlog is in
`have-fish-ops/audits/`. The rules that matter in a session:

- **Issue first.** Work has an issue before it has a branch. Parents (`type:epic`) hold
  sub-issues; a story of an epic is a sub-issue of that epic's parent.
- **One PR per issue.** The PR body ends with `Closes #N` (or
  `Closes lesterhan/have-fish-ops#N` across repos). Merging closes the issue and moves the
  Project card; nothing else is needed.
- **Cross-repo references are fully qualified**: `lesterhan/have-fish-ops#10`. A bare `#10`
  means this repo's issue 10.
- **What goes where.** Code, UX, mobile, docs and release work are issues here. Anything
  describing an unfixed weakness in the running hosted instance, or business, legal,
  pricing and support, is an issue in `have-fish-ops`, never here. The fix for a private
  weakness is still an ordinary public PR that says what it hardens, not what was exploitable.
- **Labels**: `type:` (`epic`, `bug`, `backlog`, `decision`, `probe`), `phase:` (parents
  only), `area:`, `who:` (`claude`, `human`, `pair`; a first guess, change freely), `size:`
  (`XS` under an evening, `S` 1–2, `M` 3–5, `L` 6+). No priority label: priority is the
  Project's `Next` column and its row order, and that is a human's call.
- **Dependencies** are one line in the body, `Depends on: #N`. Check it before starting;
  nothing enforces it.
- **Decisions are issues, and only the user closes them.** Whenever a session hits a
  choice that the conventions do not dictate and that would change the plan (a data-model
  trade-off, what to build, an order, a price, anything that alters a D-number or a
  parent's scope), it does not decide silently. It files a `type:decision` issue in the
  repo the choice affects, with the template in `have-fish-ops/tracking/README.md`
  (question, options with the recommended one first, what happens if undecided, which
  issues it blocks), adds `Blocked by: #N` to the affected issue, and then either
  continues on the recommended default if that is cheap to reverse, or stops and says so.
  Small implementation choices are not decisions; they go in the PR body as before.
- **Deciding.** The user comments `Decision: <choice>. Because <reason>.` and closes the
  issue, or says "**decided #N: <choice> because <reason>**" and the session posts that
  comment and closes it. Either way the session then **actions** it: a PR to
  `planning/productionize/00-direction.md` if a D-number changed, `Blocked by` lines
  removed from the issues it unblocked, and new issues filed for any work the decision
  creates. Closed `type:decision` issues are the decision log; nothing is logged twice.
- **`type:probe`** closes with the numbers as a comment; the decision it feeds is its own
  issue.
- **Parents never get a PR.** A parent closes when its last sub-issue does, after the gate
  in its body is checked. Sub-issue order is the suggested sequence; reorder by dragging.
- **Frozen files.** `planning/TASKS.md` and `planning/BUGS.md` are no longer edited; their
  open items became issues. `planning/ROADMAP.md` stays as the index of epic files.

Things you can say:

- "**let's pick up #282**": read the issue, its parent, and the audit section it names. If
  the parent has a `planning/epics/` file, follow the Epic Workflow below. Otherwise
  implement it directly: one branch, one PR, `Closes #282`.
- "**what should I pick up?**": list open `who:human size:XS` issues with no open dependency.
- "**plan phase P1**": read the parent, check each sub-issue's dependencies against what is
  closed, propose an order, reorder the sub-issues to match.
- "**file this**": create the issue in the right repo with the right labels and parent. Do
  not start a branch.
- "**decided #N: <choice> because <reason>**": post the decision comment, close the issue,
  and action it as above.
- "**what's waiting on me?**": list open `type:decision` issues across the repos, each with
  its recommended option and what it blocks.

Claude can create, label, parent and comment on issues in any attached repo. It cannot
move Project cards; cards move on PR merge (automatic) or by hand.

## Epic Workflow

### Starting an epic — "let's pick up [epic name]"

When the user says this:

1. Read the epic file from `planning/epics/`. List all stories as a numbered checklist so the user can see the full scope. If the epic touches the UI and has no `## UX brief` section, write one first (format in `DESIGN.md` §7) and confirm it before writing code. Make sure the epic has a `type:epic` parent issue and one sub-issue per story (create what is missing; the epic file's header links the parent issue), so the Project shows the epic's progress.
2. Start story 1. Implement it fully — complete, production-quality code with comprehensive tests.
3. After finishing the story, present a brief summary of what was produced and **open a PR** against `main` on the public (`have-fish`) repo, its body ending with `Closes #<story issue>`. Share the PR link for review.
4. Wait for the user to confirm they are done reviewing.
5. Once confirmed, re-read all files changed in that story and check for non-functional issues: security, performance, correctness, type safety, anything that would not pass a prod review. For UI stories, run the review checklist in `DESIGN.md` §9. Fix anything that warrants fixing before shipping (push the fix to the same PR branch).
6. Confirm the story is prod-ready. The user merges the PR on GitHub, then runs `git checkout main && git pull origin main` locally.
7. Move to the next story and repeat from step 2.
8. After all stories are complete, ask if the user wants any additional tweaks before wrapping up.

### Wrapping up an epic — "we're wrapping up [epic name]"

When the user says this:

1. Move the epic file from `planning/epics/` to `planning/epics/archive/`.
2. Update `planning/ROADMAP.md` — change the epic's status to `Done` and update the file link to point to the archive path.
3. Close the epic's parent issue with a one-line comment (every sub-issue should already be closed by its PR).
4. Confirm done.

## How I Like to Be Assisted

- **I'm hands-off on code** — implement features fully and correctly. Don't produce skeleton or partial code that requires me to fill in the gaps.
- **We design together** — before writing code for a new epic or a non-trivial feature, discuss the approach in the epic file under `planning/`. I want to understand and shape what we're building, even if I'm not writing it.
- **Tests prevent regression** — I'm using the app in the wild while traveling. Write comprehensive tests for every new route and behaviour. Tests are not an afterthought.
- **PRs, not direct pushes** — all work goes through a branch and a pull request opened against `main` on the public `have-fish` repo. Never push directly to `main`. This is the gate that keeps the deployed app stable.
- **Explain non-obvious decisions** — when you make a choice that isn't dictated by the existing conventions (data model trade-offs, architectural decisions, security choices), say so briefly. I don't need narration of mechanical steps.

## PR Workflow

### Naming

Uniform titles and branches, JIRA-shaped without the ticket numbers. The epic slug is
the identifier — it is the closest thing this repo has to a ticket, and it links a PR
back to `planning/epics/`.

**PR title** — `[scope] Imperative description`

```
[trust-signals] Story 2 — rollup tiles carry their as-of
[mobile-cash]   Fix keyboard overlap on bottom sheets
[accounts]      Fix the tab strip, which ignored clicks
[repo]          Add a pull request template
```

- **scope** is the epic slug when the work belongs to an epic, otherwise the surface or
  area in one word (`accounts`, `import`, `mobile`, `design`, `repo`, `ci`).
- Epic stories carry `Story N — ` after the scope, matching the story numbers in the
  epic file. One story per PR, per the Epic Workflow above.
- Imperative mood, no trailing full stop, ~70 characters so GitHub's list view doesn't
  truncate it.

**Branch** — `<author>/<scope>_<short-description>`

```
lhan/trust-signals_rollup-as-of
claude/accounts_tab-strip-clicks
```

Author prefix is `lhan/` or `claude/`. Scope matches the title's. Description is two or
three words, hyphenated — enough to recognise in `git branch`, not the whole title.

Branches created by Claude Code on the web are named by the harness and cannot follow
this; the title convention is what holds in every case.

### Normal feature flow

```bash
# 1. branch off main
git checkout -b lhan/<scope>_<short-description>

# 2. implement, commit
git push -u origin lhan/<scope>_<short-description>

# 3. open PR on GitHub, titled [scope] Description, body ending "Closes #N" — Claude does this in the epic workflow
# 4. review, iterate, merge on GitHub

# 5. sync local main after merge
git checkout main
git pull origin main
```

### After merging a PR that originated elsewhere

```bash
git checkout main && git pull origin main
```

## Conventions

- Amounts stored as `numeric(12,2)` strings in Postgres — treat as strings, not floats
- UUIDs as primary keys throughout
- Negative amounts = expenses, positive = income
- All timestamps stored in UTC
- Default currency is CAD
- Soft deletes — records are never hard deleted. Use `deletedAt` timestamp; `null` means active. Query active records by filtering `deletedAt IS NULL`.
