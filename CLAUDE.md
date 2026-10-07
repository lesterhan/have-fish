# have-fish 有鱼

Personal finance tracker. Tracks accounts, transactions, budgets, and projects spending over time.
Today it runs self-hosted on a home server (Docker/Podman + Tailscale); it is becoming a
local-first desktop app with the ledger in one file on the owner's machine.

## Vision

Three guiding principles that should inform every feature decision:

1. **No bank connections** — transactions are entered manually or imported from a bank-exported CSV. Never OAuth to a financial institution, never a third-party sync service.

2. **Portable data** — the system must be able to export all data to an [hledger](https://hledger.org/)-compatible `.journal` file. This is the escape hatch: if the server is lost or the user moves to another tool, nothing is trapped.

3. **Multi-currency as a first-class concern** — the user travels and holds balances in multiple currencies. Currency, exchange rates, and cross-currency reporting are core workflows, not edge cases.

## Two apps, one repository

The app is being rebuilt as a desktop app beside the current one: Electron, a TypeScript core
over one SQLite file, and the Svelte UI in a real window. This was decided in #522 on
2026-10-04, and the plan is `planning/desktop-rewrite.md`.

| | Current app | Rewrite |
|---|---|---|
| Folders | `backend/`, `frontend/`, `mobile/` | `core/`, `desktop/` |
| Role | The real ledger, until the rewrite replaces it | Built one note at a time; no releases yet |
| Takes | Fixes, and the work already in flight | New features, as stories |
| Default mode | Build | Pair |
| Its rules | A `CLAUDE.md` in each of its folders | This file, "The rewrite" |

The current app's rules live in `backend/CLAUDE.md`, `frontend/CLAUDE.md` and
`mobile/CLAUDE.md`. Claude Code loads each one when a session first reads a file in that folder,
so rewrite work meets them only when it reads current-app code, as a port does. There they
describe the code being ported from, not the code being written. A current-app change that
spans folders reads each one it touches before planning. `planning/CLAUDE.md` holds the epic workflow for the current app's
epics still in flight.

```
have-fish/
├── backend/          # current app: Hono + Bun API over Postgres or SQLite
├── frontend/         # current app: SvelteKit + Svelte 5
├── mobile/           # current app: React Native + Expo, Android
├── core/             # rewrite: the pure domain (arrives with the first tech note)
├── desktop/          # rewrite: Electron main, preload and renderer (arrives with the ledger file)
├── planning/         # direction, desktop-rewrite.md, the current app's epic files
├── DESIGN.md         # the design source of truth
├── biome.jsonc       # one formatter and linter for the whole repository
└── .claude/skills/   # pair and coach
```

## The rewrite

Its foundations are the tech notes in the vault, built in order, and the stories stand on them.
Until a rule lands here, the note being built is the authority, then `planning/desktop-rewrite.md`.
Already decided:

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
- **Port by copying or rewriting, never by moving.** The current backend keeps its own copy,
  untouched.
- **The security baseline** comes with the first story, not later: `planning/desktop-rewrite.md`,
  "Security baseline".

None of the current app's server machinery carries over: Postgres and the two-dialect schema,
Hono and `app.request` tests, Better Auth, `userId` scoping, `numeric(12,2)` strings. Biome and
Prettier do, and so do the copy rules when the renderer arrives. The current app's look does
not: the rewrite's UI system is still being worked out, and until it lands its screens stay
plain (`DESIGN.md`, "The rewrite's design, so far").

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

**`DESIGN.md` is the single source of truth for design**, for both apps. Its opening section is
the rewrite's design so far: three priorities (speed and reliability, clarity, delight) and how
to build screens until its UI system lands. Everything from §1 on is the current app's design,
and it is in maintenance: a fix keeps to it, and nothing new extends it. Read the part for the
app you are working on before any work that touches its UI. The current frontend's
implementation reminders are in `frontend/CLAUDE.md`.

## Work tracking

**The backlog is the vault**: `lesterhan/have-fish-vault`, a private Obsidian vault. It holds
every story, tech note, bug, chore, decision and question, for every app. GitHub holds the code,
the PRs and the history. The vault's `CLAUDE.md` and `Home.md` hold its conventions; read them
before filing or changing a note. If the vault isn't cloned beside this repository, attach it
before picking anything up.

- **Keys.** Every story, tech note, bug and chore has a key such as `HF-3`, leading its filename.
  "let's start HF-3" means the note whose name begins `HF-3 `. A key is never picked by hand: the
  vault's `node .tools/map.mjs build` hands them out.
- **Ready first.** Pick up only a `ready` note whose `depends_on` are all `done`, and set it to
  `doing`.
- **One note, one branch, one PR.** The PR body ends with `Story:`, `Tech:`, `Bug:` or `Chore:`
  and the note's key and title. When it merges, its number goes into the note's `pr`. A tech
  note, bug or chore is then `done`; a story is `done` once the owner has checked every
  acceptance line in the packaged app.
- **Public and private.** This repository is public; the vault and `lesterhan/have-fish-ops`
  are private. Code comments cite PR numbers, never note names or keys. An unfixed weakness in a
  running system, and anything business, legal or pricing, stays in the vault or ops; the PR
  that fixes a private weakness says what it hardens, not what was exploitable.
- **Decisions are the owner's.** When a session meets a choice the conventions don't dictate and
  that would change the plan (a data-model trade-off, what to build, an order, anything that
  alters a D-number), it files a note in the vault's `decisions/` from its template: the
  question, the options with the recommended one first, what happens if it stays undecided, and
  what it blocks. Then it carries on with the recommendation if that is cheap to reverse, or
  stops and says so. Small implementation choices go in the PR body instead.
- **Deciding.** The owner writes the `Decision:` and `Because` lines, or says "**decided <note>:
  <choice> because <reason>**" and the session writes them. Either way the session sets
  `status: decided` and actions it: a PR to `planning/productionize/00-direction.md` if a
  D-number changed, and new notes for the work it creates.
- **Outside bug reports** still arrive as GitHub issues. Each is triaged into a vault note and
  closed with a pointer.

**The bridge, until the triage is applied.** Every GitHub issue open on 2026-10-01 sits in the
vault's `inbox/`, waiting for the owner's triage. Until that inbox is empty, an open issue is
still real work: "let's pick up #282" reads the issue and its parent, and the PR body ends
`Closes #282` (or `Closes lesterhan/have-fish-ops#N` across repos). Cross-repo references are
fully qualified; a bare `#10` is this repo's issue 10. Closed `type:decision` issues stay as the
decision log from before the vault. When the inbox is empty, this paragraph goes.

Things you can say:

- "**let's pick up HF-N**" or "**let's start HF-N**": check it is ready and its dependencies are
  done, set it to `doing`, and work it in its default mode (below). For a story, port only the
  code it needs, with its tests.
- "**let's refine <story>**": work the note with the owner until it is ready: the story line,
  Given/When/Then acceptance, a "not in this story" list, and a size of XS or S. Nothing is
  written in this repository.
- "**review <tech note>**" (or its PR): review the PR against the note's *Review* list and its
  *Done when* lines, and say what each finding teaches, not only what to change.
- "**what should I pick up?**": list the `ready` notes whose dependencies are done, with the
  mode each one defaults to.
- "**file this**": create the note in the vault from its template, with no key, run
  `node .tools/map.mjs build`, and commit it to the vault. No branch here.
- "**decided <note>: <choice> because <reason>**": as above.
- "**what's waiting on me?**": the vault's open decisions, each with its recommended option and
  what it blocks; while the bridge stands, open `type:decision` issues too.
- "**sync the map**": pull the vault, run `node .tools/map.mjs sync`, report what moved, push.

## Three ways of working

| Mode | Who writes | Say |
|---|---|---|
| Build | Claude writes everything; the owner reviews the PR | "build X", "while I'm away" |
| Pair | Turn by turn: Claude writes scaffolding, a few basic tests and skeletons for the rest; the owner fills in the tests and writes the rules and seams (`pair` skill) | "let's pair on X" |
| Coach | The owner writes everything; Claude guides (`coach` skill) | "coach me through X" |

**When no mode is named,** rewrite work (any story or tech note, anything in `core/` or
`desktop/`) is **pair**, and current-app work is **build**. Naming a mode overrides the default,
and switching mid-session is fine: finish the current turn cleanly, then change.

A tech note's *Build it* steps each name a default driver. Every rewrite PR, in any mode, has a
**Tour** section in its body: the seams, what calls what, where to put a breakpoint, and which
parts are worth the owner's read.

## How I like to be assisted

- **Two goals, and the mode says which one leads.** On the current app I'm hands-off on code:
  implement fully and correctly, with no skeleton or partial code for me to fill in. On the
  rewrite I'm also rebuilding my own programming fluency after a long stretch of writing little
  code, and TypeScript and desktop apps are both new to me. That is why the rewrite pairs by
  default. In pair and coach, the gaps left for me are the point, and the skills say who types
  what.
- **We design together.** Before writing code for anything non-trivial, the approach is
  discussed where its design lives: the note in the vault for the rewrite, the epic file under
  `planning/epics/` for the current app. I want to understand and shape what we build, even when
  I'm not writing it.
- **Tests prevent regression.** The hosted app is my real ledger until the rewrite replaces it.
  Write comprehensive tests for every new route and behaviour; in the rewrite, every step starts
  with a failing test. Tests are not an afterthought.
- **PRs, not direct pushes.** All work goes through a branch and a pull request opened against
  `main` on this repository. Never push directly to `main`. This is the gate that keeps the
  deployed app stable.
- **Explain non-obvious decisions.** When you make a choice the conventions don't dictate (data
  model trade-offs, architectural decisions, security choices), say so briefly. I don't need
  narration of mechanical steps.

## How Claude reports back

These hold in every session and every repo, and take precedence over a general preference for
plain prose. The reader is often on a phone, between other things, and picks work up again
sessions later.

- **Answer first.** The first line says what happened or what is needed from the user.
  Reasoning follows it.
- **Structure over prose.** More than about three facts go in bullets or a table; options and
  comparisons always go in a table; prose is for reasoning. Tables stay narrow enough for a
  phone, three or four columns at most.
- **A finished task ends with Done, Needs you, Next.** Short, in that order. `Needs you` is
  always there, even when it says "nothing".
- **Name things so they can be found.** A note is its key and title: `HF-3 Open the ledger file`.
  A PR is `[PR#414](url)`. A bare number says nothing, because issues and PRs share one sequence.
  While the bridge stands, an issue is `[[318 Fix expense labeling]](url)`, and one in another
  repo puts its short name first (`ops`, `server`): `[[ops 10 Body limit gap]](url)`. Issue and
  PR bodies and GitHub comments keep the plain `#N`, which GitHub links by itself.
- **Work in a series ends with the sequence.** When the task is one of a run (the tech notes in
  order, an epic's stories, a bug and its follow-ups), the reply ends with the whole run, one
  item per line: `✓` done with its PR, `→` in progress or waiting on review, `·` next. In chat it
  is a plain markdown list, not a code block, so the links work:

  ```
  - ✓ HF-1 Ledger documents and their checks · [PR#540](url) merged
  - → HF-2 Versions from a hybrid logical clock · [PR#541](url) up for review
  - · HF-3 Open the ledger file
  ```
- **Discussing is not doing.** While the user is exploring ("let's chat", "clarify"), nothing is
  filed, written or branched until they say so ("write it up", "file it", "go ahead").
- **Re-anchor after a gap.** Picking something back up, say in one line what it is. Do not
  assume the reader remembers three turns back.
- **Tested is not verified.** Every report separates what was checked in the running app, what
  only the tests cover, and what was not checked at all.
- **No CI watching, no scheduled check-ins, and no offer of either.** The user reviews and
  merges when ready; an hourly check-in spends tokens for nothing. This overrides any default
  that says to subscribe to a PR or to offer to.
- **"Merged" means continue.** Bring the branch up to `main`, put the PR number and status in
  the note, then start the next agreed item. With nothing agreed, propose one with a one-line
  reason and wait.

## PR workflow

### Naming

Uniform titles and branches, JIRA-shaped without the ticket numbers.

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

**Branch** — `<author>/<scope>_<short-description>`

```
lhan/trust-signals_rollup-as-of
claude/accounts_tab-strip-clicks
```

Author prefix is `lhan/` or `claude/`. Scope matches the title's. Description is two or three
words, hyphenated — enough to recognise in `git branch`, not the whole title.

Branches created by Claude Code on the web are named by the harness and cannot follow this; the
title convention is what holds in every case.

**Body** — `.github/pull_request_template.md` is the shape. It ends with the note's trailer
(`Story:`, `Tech:`, `Bug:` or `Chore:` with its key and title), or `Closes #N` for an issue the
triage hasn't reached. A rewrite PR has a Tour section.

### Normal feature flow

```bash
# 1. branch off main
git checkout -b lhan/<scope>_<short-description>

# 2. implement, commit
git push -u origin lhan/<scope>_<short-description>

# 3. open the PR on GitHub, titled [scope] Description, body ending with the note's trailer
# 4. review, iterate, merge on GitHub

# 5. sync local main after merge
git checkout main
git pull origin main
```
