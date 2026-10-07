# frontend/: the current app's web UI

These are the current app's rules. Claude Code loads this file when a session first reads a file
under `frontend/`. The rewrite (`core/`, `desktop/`) does not follow them, though its renderer will
port the tokens, components and copy when a story first needs them.

## Stack

SvelteKit + Svelte 5 (TypeScript), built static and served by the backend in production. In
local development Vite serves it on 8888 and proxies `/api` to the backend on 8887.

## Structure

```
frontend/src/
├── styles/
│   ├── tokens.css   # Design tokens — single source of truth for all visual values
│   └── base.css     # Global reset and baseline typography
├── routes/          # SvelteKit file-based routing
└── lib/
    ├── components/  # Reusable Svelte components
    ├── copy/        # User-facing strings, one file per surface (below)
    └── api.ts       # Typed fetch helpers for the backend
```

## Commands

```bash
# From frontend/
bun run dev           # start dev server
bun run build         # production build
bun run check         # TypeScript + Svelte type checking
bun run test          # unit tests, the copy and token tests among them
bun run lint          # Biome, scoped to frontend/ (root CLAUDE.md, "Formatting and linting")
bun run format        # Prettier for .svelte, Biome for everything beside them
```

## Design system

**`DESIGN.md` at the root is the single source of truth for design** — the aesthetic, the token
vocabulary, UX principles, interaction laws, the rules for reusing vs. replacing components, and
the process for evolving the UI. Read it before any work that touches the UI.

Implementation reminders that belong with the build instructions:

- `src/styles/tokens.css` holds every visual value. Never hard-code a colour, space, radius, or
  shadow — always a token.
- `src/styles/base.css` is the global reset and baseline typography. Both are imported once in
  `+layout.svelte`.
- CSS variables in scoped `<style>` blocks inside `.svelte` files. No CSS framework.
- One component per file under `src/lib/components/`.

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

User-facing strings live in `src/lib/copy/`, one file per surface, imported as a namespace:
`import { copy } from '$lib/copy'`, then `copy.auth.signIn.title`. This is being rolled out
surface by surface (`planning/epics/copy-extraction.md`); a file that has been converted is listed
in `CONVERTED` in `copy.test.ts`, and that test fails if a hardcoded string reappears in it. A
converted *directory* covers its `.ts` modules too — a label table is copy wherever it is
declared — and the markup check reads this app's word-bearing component props (`tooltip`,
`hint`, `caption`, …) as well as `title` and `aria-label`.

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

The backend answers a failure with a code, never a sentence (`backend/CLAUDE.md`), and
`copy/errors.ts` owns the words for every code; `copy/errors.test.ts` fails on a code with no
sentence or a sentence with no code.

No i18n library, no `en/` folder implying a sibling — a typed object is the whole design.
