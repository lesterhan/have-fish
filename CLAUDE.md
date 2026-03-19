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
bun run db:generate   # generate SQL migrations from schema changes
bun run db:migrate    # apply migrations to the database
bun run db:studio     # open Drizzle Studio (DB GUI in browser)

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
- After changing `schema.ts`, run `db:generate` then `db:migrate` before running tests

## Environment

Copy `.env.example` to `.env` in the backend directory for local dev:
```
DATABASE_URL=postgres://havefish:havefish@localhost:5432/havefish
PORT=8887
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:8887
FRONTEND_URL=http://localhost:8888
```

## Design System

- **Styling approach**: CSS variables for tokens, scoped `<style>` blocks in `.svelte` files — no CSS framework
- **Tokens**: `frontend/src/styles/tokens.css` is the single source of truth for all visual values (spacing, color, typography, radius, shadow, transitions). Never hard-code colors, spacing, or shadows — always reference a token variable.
- **Base styles**: `frontend/src/styles/base.css` provides a global reset and baseline typography. Both are imported once in `+layout.svelte`.
- **Components**: Reusable UI pieces live in `frontend/src/lib/components/`. One `.svelte` file per component.

### Component pattern

Every component follows this structure:

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
    padding: var(--sp-md);
    color: var(--color-text);
    background: var(--color-surface);
    border-radius: var(--radius-md);
  }
</style>
```

### Amount display convention

Use `--color-amount-positive` (green) for income and `--color-amount-negative` (red) for expenses. Negative amounts in the data are expenses; positive are income.

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
