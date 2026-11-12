# Commands

Main is grouped by feature: `main/features/<name>/` holds what one part of the app does, on the
core (the rest of `main/`). The window reaches main only through a command, which runs here.

## A new command, in order

1. **Its schema and value**: `shared/commands/<feature>.ts`, in `<feature>Inputs` and
   `<Feature>Values`. What several features use goes in `shared/commands/wire.ts`.
2. **Its service, test first**: `main/features/<feature>/`, the test beside it. Code two features
   need goes into the core, named for what it is, as `commands/applied.ts` did.
3. **Its handler**: `main/features/<feature>/commands.ts`. A new feature's map is spread into
   `registry.ts`, and its schemas into `shared/commands/index.ts`.
4. **A new failure code**: in `core/src/outcome.ts`, with its words in `copy/errors.ts`.
5. **Its caller** in the window, with any words in `copy/`.

## What the edge keeps

- An input reaches its handler only through its schema: `run.test.ts`, "an edit names its spend
  by a UUID, or never reaches the command".
- A refusal crosses as `{ error, detail }`, a throw as `UNEXPECTED`, and the log never holds the
  input: `run.test.ts`.
- A command without a handler fails to compile: `handlers.test.ts`.
- `registry.ts` and `shared/commands/index.ts` only assemble: `registry.test.ts`, `index.test.ts`.
- No feature imports another, directly or through the registry, `run.ts` or the schemas' index,
  and nothing outside main imports main: `main/layers.test.ts`.
- A write gets its version and outbox row in `main/ledger/`: `ledger/apply.test.ts`, "applyLocal,
  one document", and `ledger/outbox.test.ts`, "a local write".
