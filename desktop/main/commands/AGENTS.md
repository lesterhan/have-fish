# Commands

Main is grouped by feature: `main/features/<name>/` holds what one part of the app does, on the
core (the rest of `main/`). The window reaches main only through a command, which runs here.

## A new command, in order

1. **Its schema and value**: `shared/commands/<feature>.ts`, in `<feature>Inputs` and
   `<Feature>Values`. What several features use goes in `shared/commands/wire.ts`.
2. **Its service, test first**: `main/features/<feature>/`, the test beside it.
3. **Its handler**: `main/features/<feature>/commands.ts`. A new feature's map is spread into
   `registry.ts`, and its schemas into `shared/commands/index.ts`; neither writes its own.
4. **A new failure code**: in `core/src/outcome.ts`, with its words in `copy/errors.ts`.
5. **Its caller** in the window, with any words in `copy/`.

## What the edge keeps

- Every input is parsed by its schema before a handler sees it: `run.test.ts`.
- A refusal crosses as `{ error, detail }`, and a throw as `UNEXPECTED`: `run.test.ts`.
- One log line per command, never its input: `run.test.ts`.
- A command without a handler fails to compile: `handlers.test.ts`.
- No feature imports another; only `registry.ts` imports a feature; nothing outside main imports
  main: `main/layers.test.ts`. Shared code goes into the core, named for what it is.
- A write to a document goes through `main/ledger/`, which keeps its versions and outbox.
