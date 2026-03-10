# have-fish 有鱼

Personal finance tracker. Tracks accounts, transactions, budgets, and projects spending over time.
Built for self-hosting on a home server (Docker/Podman + Tailscale).

## Stack

- **Backend**: Hono + Bun (TypeScript)
- **Frontend**: SvelteKit + Svelte 5 (TypeScript)
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: Better Auth (not yet implemented)
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
        ├── routes/          # SvelteKit file-based routing
        └── lib/
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
PORT=3001
```

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
