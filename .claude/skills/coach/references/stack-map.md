# Stack map: what a JVM backend engineer needs re-mapped

Read this to calibrate explanations. It covers the **current app** (`backend/`, `frontend/`).
The rewrite's stack (Electron, better-sqlite3, vitest) gets its translations in the pair skill's
`references/rewrite-map.md` as its code arrives.

Every file path below was real when written — open it and quote the actual lines rather than
paraphrasing from here, since the code moves and this file doesn't. If a reference has drifted,
fix it here.

The through-line: **this stack has almost no magic.** No DI container, no classpath
scanning, no annotation processors, no lazy loading, no dirty checking. Nearly
everything is an explicit function call you can `gd` into. For someone used to
Spring that is disorienting at first and then liberating — when something happens,
some line of code made it happen, and that line is reachable.

## TypeScript ≈ Java's syntax, a different type system

The language underneath everything, and new to them. The differences that bite first:

- **Structural, not nominal.** Two types with the same shape are the same type. There is no
  `implements` needed to satisfy an interface.
- **Unions and narrowing.** `{ ok: true; value: T } | { ok: false; failure: ErrorBody }`
  (`Outcome`, `backend/src/errors.ts:289`) is the house way to return a failure without
  throwing; an `if (!result.ok)` narrows it, and after that check the compiler knows which half
  it has.
- **Types inferred from values.** A Zod schema is declared once and its type is derived from it,
  rather than writing a class and then a validator.
- **The strict flags** in `backend/tsconfig.json` (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) produce errors with no Java equivalent; each has a comment there
  saying what it buys.

## Bun ≈ JVM + Maven + JUnit runner, one binary

`bun test` runs the suite, `bun run dev` hot-reloads, `bun add` installs. No
separate test framework — `bun:test` ships with it and the API is Jest-shaped
(`describe`/`it`/`expect`/`beforeEach`). See `backend/src/routes/rules.test.ts:1`.

Worth knowing: `NODE_ENV=test` is set by the `test` script in
`backend/package.json`, and `backend/src/db/pg/client.ts:13` branches on it to pick
`TEST_DATABASE_URL`. That is the entire test-vs-dev database mechanism — one line, no profiles,
no `@ActiveProfiles`.

## Two builds, one codebase ≈ Maven profiles, done with import conditions

The same code runs on Postgres (the hosted server) and SQLite (the local build). `backend/package.json`'s
`imports` map sends `#dialect/*` to `src/db/pg/` by default and to `src/db/sqlite/` under
`--conditions=sqlite`. `bun run test:sqlite` runs the whole suite the second way. The two schema
files must match (`db/schemas.test.ts`). `backend/ARCHITECTURE.md`, "Two builds, one set of
queries", has the rest.

## Hono ≈ Spring MVC, minus the container

- A route file is a `new Hono()` instance that exports itself; `backend/src/build-app.ts` mounts
  it with `app.route('/api/rules', rulesRoute)`. Mounting order is significant —
  `build-app.ts:81` has a comment explaining why `accountCoverageRoute` is registered before
  `accountsRoute`. Closer to Express than to Spring's annotation dispatch.
- `c` is the request context: `c.req`, `c.json()`, `c.get()`, `c.set()`.
- **Auth is one middleware.** `build-app.ts:72` guards `/api/*` and hands each request to the
  edge's `authenticate`, which sets `userId` (`build-app.ts:50`). Handlers read
  `c.get('userId')` (`backend/src/routes/rules.ts:44`). That is the `SecurityContextHolder`
  equivalent, and the typing comes from the `AppVariables` type at `build-app.ts:25`.
- **Validation is a Zod schema beside the handler**, not `@Valid`. `parseBody(c, Schema)`
  (`backend/src/validation.ts:273`) parses the body; `routes/rules.ts:39-42` is the pattern. A
  failure is a code, never a sentence: `fail(c, 'CODE')` from `backend/src/respond.ts:18`, and
  the frontend's `copy/errors.ts` owns the words. Tests fail if a route goes back to
  `c.req.json()` or writes an `error: '…'` string.

## Three layers ≈ controller, service, domain, held by a test

- A **route** parses, reads `userId`, calls a service, answers.
- A **service** (`*-service.ts`) is the only kind of file that touches the database. It returns
  an `Outcome` rather than throwing, so the route picks the status.
- A **domain module** is a pure rule with no database, Drizzle or Hono, not even a type import.
  `backend/src/rules/target.ts:21` (`readRuleTarget`) is a small one.

`backend/src/layers.test.ts` reads every import and fails on the first one across the line.
Spring would leave this to code review; here a test holds it.

## Drizzle ≈ jOOQ, not JPA

This is the biggest re-map, and the one most likely to cause a wrong assumption.

- **No entities, no session, no identity map, no dirty checking.** You never mutate
  an object and expect a flush. Every write is an explicit `db.insert(...)`,
  `db.update(...).set(...)`, `db.delete(...)`.
- **No lazy loading, no N+1 by accident.** Joins are written by hand
  (`innerJoin` at `backend/src/rules/rule-service.ts:44`). If you didn't join it, it isn't there.
- Queries return arrays, so the idiom is destructuring the first row:
  `const [owned] = await db.select(...)`. A miss is `undefined`, not an exception —
  the `if (!owned) return ...` is doing real work. When the row is guaranteed (an insert),
  `returnedRow()` from `backend/src/db/returning.ts` says so out loud; never `!`.
- The schema files are the source of truth for the database shape, one per dialect
  (`backend/src/db/pg/schema.ts`, `backend/src/db/sqlite/schema.ts`). Migrations are
  **generated by diffing them**, not written: `bun run db:generate` emits SQL into
  `backend/drizzle/` for both dialects, then `db:migrate` and `db:migrate:test` apply it to each
  database. Closer to `hbm2ddl` producing checked-in Flyway files than to writing
  Flyway by hand. Never hand-edit `backend/drizzle/`.
- Forgetting `db:migrate:test` is the classic first-week mistake: dev works, the
  suite fails with a missing-column error. Worth letting them hit once.

## Better Auth ≈ Spring Security, pre-wired

Its tables live in both schema files under the "Better Auth tables" comment
(`backend/src/db/pg/schema.ts:18`) and must not be renamed. Tests get a real session by calling
`createTestUser()` (`backend/src/test-utils.ts:107`), which signs up over the real endpoint and
returns the `Cookie` header string to pass into subsequent requests. No mocked principals.

## Testing ≈ JUnit + Testcontainers, but faster and stranger

- `app.request('/api/rules', { headers: { Cookie: cookie } })` calls the fetch
  handler **in-process**. No port, no socket, no `@SpringBootTest` startup cost —
  but also no serialization boundary to hide behind. Tests go through `request()` and read
  lists through `at()`, both from `test-utils.ts`.
- The database is real, not H2 and not a mock: Postgres under `bun test`, SQLite under
  `bun run test:sqlite`. `clearDatabase()` (`test-utils.ts:25`) deletes in FK-dependency order in
  `beforeEach`; the ordering comment there is load-bearing, and adding a table to the schemas
  usually means adding a line there too.
- Every test run is offline: a preloaded `fetch` throws for anything past loopback.
- Tests seed through helpers at the top of the file (`createAccount`,
  `seedTransaction` in `backend/src/routes/rules.test.ts:9`) rather than fixtures or builders.

## Svelte 5 ≈ signals, not a virtual DOM

If their last frontend memory is jQuery or early React, the useful framing is:
Svelte compiles away, and runes are fine-grained reactive cells.

- `let { foo }: Props = $props()` declares inputs; the `interface Props` above it is
  the contract, and the doc comments on it are the component's API docs — see
  `frontend/src/lib/components/ui/GradientButton.svelte:4`.
- `$state()` is a mutable reactive cell, `$derived()` is a computed value,
  `$effect()` is the escape hatch you mostly shouldn't need.
- `children: Snippet` + `{@render children()}` is slots.
- Styles in a `<style>` block are scoped to the component automatically. No CSS
  framework, no utility classes — every visual value comes from a token variable in
  `frontend/src/styles/tokens.css`.
- Words on screen come from `frontend/src/lib/copy/`, not string literals in markup;
  `copy.test.ts` fails on a hardcoded string in a converted file.
- SvelteKit routing is file-based: `frontend/src/routes/(authed)/…`, where
  parenthesised segments are grouping-only and don't appear in the URL.
- `bun run check` is the typechecker (`svelte-check`); it catches template errors
  that `tsc` alone won't.

## Repo invariants worth making them discover

These are the things a code review here would actually catch. Don't recite them —
point at the exemplar and let them notice.

| Invariant | Where to see it |
|---|---|
| Every user-data query scopes by `userId` | `backend/src/rules/rule-service.ts:236` — `liveRule`: `and(eq(id), eq(userId), isNull(deletedAt))` |
| Soft deletes: filter `isNull(deletedAt)`, never hard-delete | same function |
| Money is `numeric(12,2)` **as a string** — `'10.00'`, never a float | `backend/src/routes/rules.test.ts:34` — `amount: '-10.00'` |
| Negative amount = expense, positive = income | `backend/CLAUDE.md`, "Conventions" |
| Access to a shared group is membership-checked, not just id-checked | `rule-service.ts:39-51` — the comment and the `innerJoin` under it |
| A failure is a code; the words live in the frontend | `respond.ts:18`, `frontend/src/lib/copy/errors.ts` |
| Timestamps are UTC | the schema files |

The money-as-string one is the friendliest to teach: the `BigDecimal` reflex is
already there, it just needs a new home. (The rewrite stores integer cents instead, so the
reflex moves again there.)
