# nvim moves, organised by what they're trying to do

Give one or two of these per turn, chosen for the task in front of them. Never
paste a section wholesale — a wall of keybindings is a reference they'll skim and
forget, not a rep.

**Two tiers, and the distinction matters.** Core vim (no leader) is stable, works
in every vim everywhere, and is where real muscle memory lives — favour it.
LazyVim leader keys are a configuration and drift between versions; when unsure,
say "check `<leader>sk`" instead of asserting a binding.

## The five that matter most for an IntelliJ convert

Drill these until they're invisible. Everything else is optional.

| Key | What it does | IntelliJ muscle it replaces |
|---|---|---|
| `.` | Repeat last change | *(no equivalent — this is the one that changes how you edit)* |
| `<C-o>` / `<C-i>` | Jump back / forward through the jump list | Navigate Back / Forward |
| `ciw` / `ci"` / `ci(` | Change inner word / string / parens | double-click-and-type |
| `gd` | Go to definition (LSP) | Cmd-B |
| `*` | Search the word under the cursor | Cmd-F on a selection |

`.` is the highest-leverage key in the editor. If they take one thing from a
session, make it the habit of *structuring an edit so `.` can repeat it*.

## Getting to a file

- `<leader><space>` or `<leader>ff` — find files by name. Fuzzy, so `rultes` still
  finds `rules.test.ts`.
- `<leader>/` or `<leader>sg` — grep the whole project. This is Find in Path.
- `<leader>sw` — grep the word under the cursor. Instant "who else uses this".
- `<leader>fr` — recent files. `<leader>,` — switch buffer.
- `<C-^>` — **toggle to the alternate file.** In this repo that's
  `rules.ts` ↔ `rules.test.ts`, since tests are co-located. Teach this early; it's
  the test-driven loop in one keystroke.
- `<leader>e` — the file tree. Useful for orienting in an unfamiliar directory,
  bad as a daily driver. Nudge them off it once they know the codebase.

## Reading code

- `gd` definition, `gr` references, `gy` type definition, `gI` implementations.
- `K` — hover docs and types. On a Drizzle query this is how you find out what a
  chain actually returns.
- `<leader>ss` — symbols in this file (the structure view). `<leader>sS` — symbols
  across the workspace.
- `%` — jump between matching brackets. `[{` / `]}` — to the enclosing block.
- `zz` — centre the current line. Small, but it's what stops the "lost in the file"
  feeling.
- `''` — back to where you jumped from. `` `. `` — to the last edit.

## Changing code

- `ciw`, `ci"`, `ci'`, `ci(`, `ci{`, `cit` (inner tag — good in `.svelte` markup).
- `daf` / `dif`, `vaf` / `vif` — around/inner **function**, via mini.ai's treesitter
  textobjects. `vif` to select a function body is the closest thing to structural
  selection. (`ac`/`ic` for a class.)
- `f{char}` / `t{char}`, then `;` / `,` — precise intra-line motion. This is what
  replaces reaching for the arrow keys.
- `<leader>cr` — LSP rename, project-wide. This one *is* IntelliJ-grade; it's the
  refactoring that survived.
- `<leader>ca` — code action. Auto-import, add missing properties, quick fixes.
- `:%s/old/new/gc` — search and replace with per-hit confirmation.
- `qq … q` then `@q`, `@@` — record and replay a macro. For the repetitive edits
  where a regex would be fiddlier than a recording. This is a genuine superpower
  IntelliJ has no answer to.

## Extracting code — the honest answer

**Stock LazyVim has no Extract Method for TypeScript.** Say this plainly rather
than hunting for a binding that doesn't exist. The manual sequence, which becomes
fast with repetition:

1. `vif` (or `V` + motion) to select the body you're pulling out
2. `d` to cut it
3. `O` above, or `}o` below, to open a line for the new function
4. type the signature, `p` to paste the body, fix indentation with `=ip`
5. back at the call site, type the call
6. `<leader>cr` on any name that needs renaming afterwards

If they do this often enough to want the real thing, `refactoring.nvim` is the
plugin to add — but let them feel the manual version first. It teaches the shape of
the code in a way the automated version doesn't.

## Diagnostics, tests, git

- `]d` / `[d` — next/previous diagnostic; `]e` / `[e` for errors only.
- `<leader>xx` — the diagnostics list (Trouble). Their "Problems" panel.
- `<C-/>` or `<leader>ft` — toggle a terminal. This is where `bun test --watch`
  should live all session; `bun run check` for the frontend.
- `<leader>gg` — lazygit. Stage hunks, write the commit, without leaving the editor.

## Discovery, so they stop needing this file

- `<leader>sk` — **search keymaps.** The answer to "what's the key for X". Point
  them here rather than answering, when the answer is cheap to find.
- Any leader key, then wait — which-key shows what's available. Exploring by
  pressing `<leader>` and reading is a legitimate learning mode.
- `:LazyExtras` — enable language support. For this repo they want the
  `lang.typescript` and `lang.svelte` extras; without the Svelte one, `.svelte`
  files get no LSP and the editor feels broken through no fault of theirs. Worth
  checking early in the first session.
- `:checkhealth` when something's off. `:help {topic}` for anything core.
