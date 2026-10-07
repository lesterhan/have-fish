# The desktop rewrite

**Status: decided 2026-10-04** ([#522](https://github.com/lesterhan/have-fish/issues/522),
option 1). The options it weighed, and the case against, live there and are not repeated here.

have-fish is being rebuilt as a desktop app: Electron, a TypeScript core over one SQLite file,
and the Svelte UI in a real window. It is built in this repository, beside the current app,
which keeps running until the new one has earned its place.

This file covers how the rewrite is planned and the technical direction it starts from. The
stories themselves live in the vault.

## How it is planned: user stories, not layers

The backlog is a **story map** in `lesterhan/have-fish-vault`, a private Obsidian vault. Its
`Home.md` is the guide.

- **Activities** across the top: what the owner does with money, in the order a week goes.
  These are *write it down*, *see where I stand*, *catch up from the bank*, *understand where it
  went*, and *keep it mine*. Multi-currency is not a column of its own: it shows up as a story
  under each activity, which is what first-class means.
- **Releases** down the side, each named by an outcome rather than a feature list:

  | Release | Outcome |
  |---|---|
  | R0 Skeleton | I write down a spend and it's still there tomorrow |
  | R1 A week at home | I could track a normal week at home in it |
  | R2 A week abroad | I could track a week abroad in it |
  | R3 Sunday catch-up | I can catch up from my bank on a Sunday without typing |
  | R4 Make it the real one | I can stop using the hosted app |

- **Stories**, one note each: As someone who …, I want …, so that …; acceptance as Given/When/Then
  lines, each one checkable in the running app; and a "not in this story" list, which is what
  keeps a story thin. Dependencies are links between notes.
- **Open questions** are notes too, linked from the stories they block.

**Ready** means the story is fully written and sized XS or S; anything bigger is split before
it is picked up. **Done** means the owner has checked every acceptance line in the packaged
app, tests cover them, and the PR is merged.

Rewrite work gets no issue in this repository. A PR's body ends with `Story: <note name>`, or
`Tech: <note name>` for a tech note: a foundation or refactoring that several stories stand on.
Every rewrite note is built in pair mode unless the owner names another (`CLAUDE.md`, "Three
ways of working"). The PR number goes back into the note. Decisions about the rewrite are notes
in the vault.

### Two rules that keep thin slices from going wrong

1. **Slice the UI thin, never the ledger.** The first story asks for an amount and a
   description, but what it writes is a real, balanced double-entry transaction. A ledger that
   stores a single amount is a migration waiting to happen.
2. **Porting is a task inside a story, never a story.** A story brings over the code from the
   current app that it needs, with its tests, and nothing else. Nothing moves because it might be
   needed later.

An earlier plan, filed the same day, split the work by layer: move the domain, then a skeleton,
then ledger services, then screens (#523). The story map supersedes it.

## Technical direction

This is where the rewrite starts. Each piece arrives with the first story that needs it, and a
story that proves a piece wrong changes this section.

### The stack

| Piece | Pick | Why |
|---|---|---|
| Shell | Electron | Main is Node, so the core runs in-process: no port, no sidecar. Chromium on Linux too |
| Database | SQLite, better-sqlite3 | One file (D8). Synchronous, so a transaction never interleaves with another command |
| Queries, migrations | Drizzle, drizzle-kit | Already known; it has sync SQLite drivers, expo-sqlite among them |
| UI | Svelte 5 + Vite | Already known, and component logic can port though the look is new (`DESIGN.md`); SvelteKit's server half has nothing to do here |
| Boundary | Zod | The renderer shows strings from bank CSVs and is the least trusted process |
| Tests | vitest on Electron's Node | `ELECTRON_RUN_AS_NODE=1`, so tests load the better-sqlite3 build that ships |
| Packaging | electron-builder | A build artifact first; the Flatpak from #518 when the rewrite replaces the current app |
| Format, lint | Biome, Prettier for `.svelte` | Unchanged |

better-sqlite3's edge over libsql is simplicity, not correctness: libsql already keeps an async
transaction atomic, which is why D8 chose it over `bun:sqlite` (#284, #286). libsql stays the
fallback. It is N-API, so it needs no rebuild per Electron version.

### Layout, as it will grow

```
core/          pure domain, copied or rewritten from backend/src when a story needs it
desktop/
├── main/      window and lifecycle; db/ (schema, migrations); services/; commands/
├── preload/   the typed bridge
└── renderer/  Svelte 5 + Vite: tokens, components, copy, pages
```

The layers are today's, renamed where HTTP leaves: **domain** in `core/`, **services**, and
**commands** where routes were. A module comes into `core/` by being copied or rewritten, never
moved: the current backend keeps its own copy, untouched. It is in maintenance until the rewrite
replaces it, and wiring it to `core/` would put a workspace, a Dockerfile change and a second
error-code scheme into a live app for nothing it needs. The two copies may drift; the old one
retires with the current app.

### The boundary: commands, not routes

- One registry of commands, each with a Zod schema and a handler. Main registers each one with
  `ipcMain.handle`; the preload exposes `invoke(name, input)`, typed from the registry.
- Failures keep today's shape, `{ error: CODE, detail }`. The words stay in `copy/errors.ts`, so
  the core still writes no sentences.
- The log gets one line per command: name, duration, outcome code. Never the input.

### Security baseline

This comes with the first story, not later:

- `contextIsolation` and `sandbox` on, `nodeIntegration` off.
- The renderer loads from an `app://` protocol, under a `default-src 'self'` CSP. Navigation and
  new windows are denied.
- Every command's input is parsed by its schema.
- One instance at a time, and a data directory only its owner can read.

No web page can reach IPC, so the localhost defences the current local build needs (launch
token, Host and Origin checks, the lockfile handshake) have nothing to guard.

### The data model

The skeleton story decides these, because they are the ledger rather than the UI. The open ones
are question notes in the vault.

- **One person per file.** No `userId`; a profile row carries the identity sync will need.
- **Amounts:** integer cents at today's precision, so that a sum in SQL is exact (answered
  2026-10-04). Documents carry canonical decimal strings, so the choice stays inside the file.
- **Documents as `sync-unit.md` describes them:** roots carry `updatedAt` and `deletedAt`,
  postings are replaced together with their transaction, and deletion leaves a tombstone.
- **Dates** are calendar-day text (`YYYY-MM-DD`). Timestamps are UTC.

## Living beside the current app

- **The hosted edition stays the real ledger** until the rewrite reaches R4. Nothing is ported
  across until a story needs it. Whether history comes over at all, or the new app starts fresh
  from opening balances, is an open question in R4.
- **The current app gets fixes and the work already in flight.** New features go into the
  rewrite as stories, unless the owner says otherwise.
- **Separate data.** Until the rewrite replaces the current app, it keeps its ledger in its own
  directory, so neither app can open the other's file.
- **No releases until it replaces the current app.** `v*` tags stay the Bun binary's, and the
  Flatpak (#518) keeps installing it.
- **Two sets of conventions.** The root `CLAUDE.md` holds what both apps share and the
  rewrite's rules; the current app's live in `backend/`, `frontend/` and `mobile/CLAUDE.md`, so
  work in `core/` and `desktop/` never loads them.
