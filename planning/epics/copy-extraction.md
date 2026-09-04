# Copy Extraction

Move every user-facing string out of the components and into copy modules, so copy can be
edited in one place by reading it as prose rather than by hunting it across 31k lines of
Svelte — and so that localisation, if it ever happens, is a build step rather than an
excavation.

## UX brief

- **Question this screen answers:** none — this epic adds no screens. It changes where the
  words on the existing screens live.
- **Inbox role:** none.
- **Primary action + interaction count:** unchanged for every flow. Any diff in this epic
  that changes rendered output is a bug, with one deliberate exception: story 2, which
  rewords the count sentences.
- **Case or work:** both, and the split matters. Case copy (window titles, section headers,
  menu labels, dialog furniture, status-bar messages) is small, stable, and period-flavoured
  — it wants to be read as a single block so its voice stays consistent. Work copy (form
  labels, empty states, import step guidance, error text) is large and churns. They get
  separate files for that reason, not for tidiness.
- **Existing patterns reused:** the `tokens.css` + `tokens.test.ts` arrangement — one file
  that is the single source of truth for a category of values, plus a test that asserts
  against the source file to stop the category leaking back out. Copy gets the same shape.
- **Patterns being stretched or replaced:** none stretched. One pattern is deleted outright
  (see below).
- **What gets deleted:** the plural-splice idiom — `transaction{n === 1 ? '' : 's'}` and its
  thirty-odd relatives — and the practice of the backend writing sentences for the user.

## Why now, and what we are actually buying

Two goals get bundled under "extract the copy" and they are not the same purchase.

**Copy-editing** is the real one. There are roughly 500 user-facing strings in the frontend
and 98 in mobile, scattered across every component. Editing the voice of the import flow
today means reading `ImportSortStep.svelte` for markup and finding the words in between.
That is worth fixing on its own, with no localisation ever happening.

**Localisation** is speculative — one user, who reads English. The epic does not build for
it. What it does is refuse to *foreclose* it, which costs almost nothing if the rules below
are followed from the start and is brutally expensive to retrofit. The single rule that
matters: **a message is a whole sentence with named parameters, never fragments glued
together at the call site.**

So: no i18n library, no locale negotiation, no message-format runtime, no `en` folder
implying a sibling. A plain typed TypeScript module. If a second locale ever arrives, the
migration to Paraglide is a scripted transform over well-shaped input — and Paraglide is the
eventual pick specifically because it compiles to plain JS functions, which mobile can
import too. Two catalogs for one app would be the actual failure mode.

## Decisions

**Copy lives in typed TS modules, not JSON or YAML.** Autocomplete on `copy.import.confirm`,
`svelte-check` catching a typo'd key, and parameters that are typed functions rather than
`{{placeholders}}` a linter cannot see. The whole benefit of extraction is lost if a renamed
key fails silently at runtime instead of loudly at build.

**Parameters are named and the message owns the whole sentence.**

```ts
// no
imported: (n: number) => `${n} transaction${n === 1 ? '' : 's'} imported`

// yes
imported: (n: number) => plural(n, `${n} transaction imported`, `${n} transactions imported`)
```

The second form is longer and that is the point: both readings sit in the copy file where
they can be edited, instead of one reading being assembled by a ternary in the markup.

**Formatted data is not copy.** Currency amounts, dates, percentages, and account paths go
through `Intl` (and the existing formatting helpers), never into a copy file. In a
multi-currency app this is a correctness surface, not a wording one — `Intl.NumberFormat`
with the right currency and locale is the whole job, and a copy file that hardcodes `$` is
a bug waiting for a trip to Japan.

**The backend stops writing sentences.** There are 269 hardcoded `error: '...'` strings in
`backend/src/routes/`. Some of them are UI instructions:

```
'No saved parser matched this CSV. Create one in Settings → Import Parsers.'
```

A route handler should not know that Settings has an Import Parsers tab. These become stable
machine-readable codes; the client owns the words. This is the structurally valuable half of
the epic and it is worth doing even if the frontend extraction stopped after one story.

**Extraction is per-surface, never a sweep.** A single big-bang commit touching every
`.svelte` file would conflict with every in-flight epic in `planning/`, and would put a
mechanical rename on top of the blame for files currently being redesigned. Each story below
is one surface, one PR, reviewable by reading the copy file as prose.

**A test keeps extracted surfaces extracted.** Mirroring `tokens.test.ts`: a test that reads
the source files of already-converted directories and fails on a bare user-facing string. It
takes an explicit allowlist for the genuine exceptions. Without it, surface six regresses
while surface seven is being written.

## Shape

```
frontend/src/lib/copy/
  index.ts          # re-export; `import { copy } from '$lib/copy'`
  plural.ts         # the plural helper + the no-fragments rule in a comment
  case.ts           # chrome: titlebar, sidebar, status bar, dialog furniture
  errors.ts         # backend error code → sentence
  accounts.ts
  import.ts
  fish-pie.ts
  transactions.ts
  ...              # one per surface, added by the story that converts it
  copy.test.ts      # the bare-string guardrail
```

```ts
// copy/import.ts
export const importCopy = {
  confirm: {
    heading: 'Ready to import',
    committed: (n: number) =>
      plural(n, `${n} transaction will be added`, `${n} transactions will be added`),
    duplicatesSkipped: (n: number) => `Skipped as duplicates: ${n}`,
    noAccount: (n: number) =>
      plural(n, `${n} row still needs an account`, `${n} rows still need an account`),
  },
} as const
```

## Stories

Each story is one PR against `main`. Stories 3–7 are independent of each other and can be
reordered or dropped without stranding anything.

**1. Foundation.** The `copy/` module, the `plural` helper, the `copy.test.ts` guardrail
with an allowlist mechanism, and the conventions written into `CLAUDE.md`. Convert `login`
and `signup` (13 strings) as the proof that the shape works end to end — small enough that
the PR is mostly the foundation, real enough that it is not a toy.

**2. De-splice the counts.** The ~30 sites listed in the appendix. No extraction, no copy
module — this story only changes wording, so it can be reviewed as a copy edit and shipped
independently. Two treatments, and which one applies is a judgement call per site:

- Where the string is a label in a `<dl>` or a stat row, reword to `label: value` form and
  the plural disappears entirely — `ImportConfirmStep`'s summary list is almost all of this.
- Where it genuinely reads as a sentence, keep both forms explicitly. `1 transaction` and
  `3 transactions` are both correct English and neither should be sacrificed to avoid a
  ternary; the fix is that both readings become visible strings, not that the count sentence
  stops existing.

The one thing that does not survive is the mid-sentence splice.

**3. Case copy.** Sidebar, status bar, window chrome, modal furniture, tooltips, menus.
Small string count, high consistency value — this is the file that keeps the period voice
coherent, and reading it as a block is the first time anyone will have seen that voice all
in one place.

**4. Settings + accounts.** ~97 strings across `routes/(authed)/settings`,
`routes/(authed)/accounts`, and `lib/components/accounts`.

**5. Import.** ~166 strings across `lib/components/import`, `lib/components/wizards`, and
`routes/(authed)/import`. The largest surface by a wide margin and the one with the most
guidance prose, so it may want splitting into wizards vs. steps once story 4 has calibrated
how long a surface actually takes.

**6. Fish Pie.** ~79 strings across `lib/components/fish-pie` and `routes/(authed)/fish-pie`.

**7. Transactions, spending, catch-up.** ~84 strings across the three remaining surfaces.

**8. Backend error codes.** Replace the 269 `error: '...'` strings with stable codes, add
`copy/errors.ts` mapping code → sentence, and update the frontend's error rendering (335
call sites reference an error value, though most are variables rather than literals — the
real count lands after story 1). Route tests assert on codes, which makes them stop breaking
on copy edits. This story is a prerequisite for mobile, which currently renders whatever the
API says.

**9. Mobile.** ~98 strings in `mobile/app` and `mobile/components`. Same module shape,
same conventions. Whether the two copy directories get physically shared or stay duplicated
is deferred to this story — sharing means a workspace package, and that is a build-system
change that should not be smuggled in earlier.

## Open questions

- Does the `copy.test.ts` allowlist go per-file or per-string? Per-file is easier to live
  with and weaker; per-string is noisy but actually holds. Decide in story 1, with real
  exceptions in hand rather than imagined ones.
- Story 5 (import) may be too big for one PR. Do not pre-split it — let story 4 set the
  pace and split if it earns it.

## Appendix: plural splice sites

For story 2. Grepped from `frontend/src/`; `AccountPicker.svelte:247,283` and
`RuleTargetEditor.svelte:37` also match `=== 1` but are keyboard and selection logic, not
copy, and are out of scope.

```
lib/components/transactions/TransactionDetail.svelte:396
lib/components/catch-up/CoverageStrip.svelte:61
lib/components/fish-pie/GroupRightPanel.svelte:432
lib/components/import/ImportPreviewPanel.svelte:159
lib/components/import/ImportConfirmStep.svelte:83,117,129,135,145,165,166,231,233
lib/components/import/ImportSortStep.svelte:114,256,257
lib/components/import/ImportAccountsStep.svelte:66
lib/components/accounts/AccountSettingsModal.svelte:569
lib/components/accounts/CategoriesTab.svelte:409,636
lib/components/accounts/QuickEntryPanel.svelte:215
routes/(authed)/transactions/+page.svelte:210
routes/(authed)/catch-up/+page.svelte:278
routes/(authed)/fish-pie/+page.svelte:143
routes/(authed)/spending/+page.svelte:353
routes/(authed)/import/rules/+page.svelte:174
routes/(authed)/import/+page.svelte:550,551,601,646,1239
routes/(authed)/accounts/+page.svelte:339,426,445,621
```
