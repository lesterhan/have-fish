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
└── frontend/
    └── src/
        ├── styles/
        │   ├── tokens.css   # Design tokens — single source of truth for all visual values
        │   └── base.css     # Global reset and baseline typography
        ├── routes/          # SvelteKit file-based routing
        └── lib/
            ├── components/  # Reusable Svelte components
            └── api.ts       # Typed fetch helpers for the backend
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

### Aesthetic

The UI is a **hybrid of 2000s Mac OS X and Windows XP era visual language**, layered with contemporary interaction patterns (smooth transitions, proper focus states, accessible focus rings).

The goal is to feel like a real desktop application, not a website. It should say "you are using a computer program."

**Primary reference: Mac OS X Graphite** — cool silver-grey shell, Lucida Grande as the system font, Aqua-style gradient buttons with subtle border-color hover rather than bevel. Dark section bars, Graphite desktop.

**Secondary reference: Windows XP** — the 3D bevel system (`--shadow-raised` / `--shadow-sunken`) for standard buttons and inset fields. Sharp corners. Crisp pixel rendering.

The two coexist: use Aqua-style gradients for pill/inline buttons (`GradientButton`), use XP-style bevels for dialog buttons (`Button`).

### Visual rules

- **No rounded corners** — `--radius-sm` and `--radius-md` are both `0`. Sharp corners only. Use `--radius-lg` (2px) or `--radius-xl` (4px) very sparingly — only on Aqua-style gradient buttons.
- **Bevel standard controls** — raised surfaces use `--shadow-raised`, pressed/inset surfaces use `--shadow-sunken`. Core XP visual language for `Button`, form fields, tracks.
- **Gradient buttons use border-color hover** — `GradientButton` and tab-style controls use a gradient background. Hover = accent border color, no bevel. Active = `--shadow-sunken`.
- **Lucida Grande at small sizes** — the system font is `Lucida Grande, Segoe UI`. Text is small (13–14px base). Period-accurate for both Mac and XP eras.
- **No font smoothing** — `base.css` sets `-webkit-font-smoothing: none` for crisp pixel rendering.
- **The desktop is Graphite** — `--color-desktop: #b8bcc2`. The entire page background.
- **Window chrome is cool silver-grey** — `--color-window: #f4f5f7`. Content areas are `--color-window-raised: #eceef2`.
- **Title bars use the Graphite gradient** — `linear-gradient(180deg, #d8dde4, #a8aeb8, #8a909a)`.

### Interaction rules (the modern layer)

- All state changes (hover, active, focus) use CSS transitions: `var(--duration-fast) var(--ease)` (100ms ease-in-out)
- Button press = `--shadow-sunken` replacing `--shadow-raised`, not an instant jump
- Focus rings must be visible and intentional — use `outline: 2px solid var(--color-accent-mid)`
- Interactive elements always have a hover state; nothing is ambiguous about clickability

### Styling approach

- CSS variables for all tokens, scoped `<style>` blocks in `.svelte` files — no CSS framework
- `frontend/src/styles/tokens.css` — single source of truth for all visual values. Never hard-code colors, spacing, or shadows — always use a token variable.
- `frontend/src/styles/base.css` — global reset and baseline typography. Both imported once in `+layout.svelte`.
- Components live in `frontend/src/lib/components/`. One `.svelte` file per component.

### Component pattern

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
    box-shadow: var(--shadow-raised);
    font-size: var(--text-sm);
    transition: box-shadow var(--duration-fast) var(--ease);
  }
</style>
```

### Amount display convention

Use `--color-amount-positive` (green) for income and `--color-amount-negative` (red) for expenses. Negative amounts in the data are expenses; positive are income.

## Epic Workflow

### Starting an epic — "let's pick up [epic name]"

When the user says this:

1. Read the epic file from `planning/epics/`. List all stories as a numbered checklist so the user can see the full scope.
2. Start story 1. Follow the coding conventions (skeleton code, minimal tests, explain decisions).
3. After finishing the story's implementation, present a brief summary of what was produced and **ask the user to review the code**.
4. Wait for the user to confirm they are done reviewing.
5. Once confirmed, re-read all files changed in that story and check for non-functional issues: security, performance, correctness, type safety, anything that would not pass a prod review. Report findings clearly — fix anything that warrants fixing before shipping.
6. Confirm the story is prod-ready and tell the user they can push.
7. Move to the next story and repeat from step 2.
8. After all stories are complete, ask if the user wants any additional tweaks before wrapping up.

### Wrapping up an epic — "we're wrapping up [epic name]"

When the user says this:

1. Move the epic file from `planning/epics/` to `planning/epics/archive/`.
2. Update `planning/ROADMAP.md` — change the epic's status to `Done` and update the file link to point to the archive path.
3. Confirm done.

## How I Like to Be Assisted

- **Learning is the priority** — we are pair programming. Explain decisions, don't just generate code.
- **Skeleton code only** — when generating implementation files, produce the bare structure with comments describing what needs to be written, not the finished code.
- **Minimal tests** — when generating test files, only write a single sanity/smoke test to establish the pattern. I will write the rest of the tests myself.

## Conventions

- Amounts stored as `numeric(12,2)` strings in Postgres — treat as strings, not floats
- UUIDs as primary keys throughout
- Negative amounts = expenses, positive = income
- All timestamps stored in UTC
- Default currency is CAD
- Soft deletes — records are never hard deleted. Use `deletedAt` timestamp; `null` means active. Query active records by filtering `deletedAt IS NULL`.
