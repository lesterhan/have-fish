# Copy Extraction

**Tracked as [#350](https://github.com/lesterhan/have-fish/issues/350)**, one sub-issue per
story below.

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

The real figure was **311** — 266 in `copy/accounts.ts`, 45 in `copy/settings.ts`. The
estimate was low because the detector that produced it read neither this app's word-bearing
component props (`tooltip`, `hint`, `caption`) nor any `.ts` module. Both now count. Done;
findings below.

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

The real count was **294** rather than 269 — the grep that produced the original figure only
matched single-quoted literals and missed every double-quoted and templated one. The frontend
half was far smaller than the 335 feared: `api.ts` is the one chokepoint and holds 66 of the
68 sites. Done; findings below.

**9. Mobile.** ~98 strings in `mobile/app` and `mobile/components`. Same module shape,
same conventions. Whether the two copy directories get physically shared or stay duplicated
is deferred to this story — sharing means a workspace package, and that is a build-system
change that should not be smuggled in earlier.

## Open questions

- ~~Does the `copy.test.ts` allowlist go per-file or per-string?~~ Settled in story 1:
  per-string, as `{ file, text, why }`, and a stale entry fails the test. Story 3 put it
  under real pressure — fifty-six strings across the whole shell — and it is still empty.
  Both candidates turned out to be detector bugs rather than exceptions: a CSS selector in
  `Modal`, and `KeyboardEvent.key` names, which are capitalised words that are not words.
  Fixing the detector is the better answer whenever the false positive names a whole class;
  the allowlist is for the string that is genuinely one of a kind. It has not met one yet.
- ~~Story 5 (import) may be too big for one PR.~~ Story 4 set the pace: 311 messages
  across 13 files, one PR, and the copy file stayed readable because it is organised by the
  component that speaks rather than alphabetically. Import's 166 is smaller than that, so it
  does not need splitting on size. Split it only if the wizards and the steps turn out to
  want different voices.

## What extracting the case turned up

Recorded because it is the argument for doing the rest of the epic, not just a log.

**The detector was blind to tooltips.** `use:tooltip={'Accounts'}` is a mustache, and story
1's scanner skipped every mustache wholesale. Story 3 is the tooltips story, so the check
would have certified a converted sidebar while every tooltip in it stayed hardcoded. The
scanner now reads string literals inside markup expressions and reports the ones shaped like
labels — sentence case, or more than one word. Lowercase single words (`'active'`, `'sun'`)
are wiring; SHOUTED ones are codes.

**Two inconsistencies, invisible until the words sat together.** The accent control was
"Choose accent colour" in `AccentPicker` and "Choose accent color" in the titlebar — two
labels for the same control, one of each spelling. The attention dot was "Needs attention"
in the sidebar and "needs attention" in the tab strip. Neither is findable by reading a
component; both are obvious in a fifty-line file. This is the copy-editing case the epic
opened with, arriving on the third story.

**A test was asserting on a copy literal.** `chromeButtons.test.ts` checked
`confirmLabel="Sign out"` in the layout source, so it failed on extraction — the frontend
version of the problem story 8 fixes for the backend. It now asserts the binding and the
meaning, not the wording.

**One reword.** The sidebar's empty state wrapped a sentence around a link — "Pin accounts
on the [Accounts] page to keep them here." A sentence split into before-link and after-link
halves is the shape this epic exists to remove, so it now ends with the link instead. This
is the only rendered change in the story that is not a fixed inconsistency.

## What the backend error codes turned up

**One idea, four spellings, and nobody could see it.** `No valid fields to update`, `no valid
fields to update`, `no fields to update`, `at least one field is required`, `No updatable
fields provided` and `At least one of accountId, amount, or currency is required` are one
failure written six times. 294 literals collapsed to 92 codes, and most of the collapse is
that shape rather than anything clever.

**`not found` meant six different things.** Thirty-five Fish Pie routes answered `not found`
for a missing group, category, expense, settlement, invitation, or the caller's own user row.
Reading them as one code made that obvious in a way reading thirty-five route files had not;
they are now six codes and six sentences. `forbidden` was the same story — eight routes, five
genuinely different rules about who may act, all of them rendered to the reader as one shrug.

**A status disagreed with itself.** `category not found in that group` answered 404 in
`rules.ts` and 400 in `fish-pie-expenses.ts` and `import.ts`. One failure gets one status now,
and the registry is where that is decided rather than at 294 call sites. The one deliberate
behaviour change in the story is `rules.ts` moving to 400 to match the other two.

**The backend was telling the reader where to click.** `No saved parser matched this CSV.
Create one in Settings → Import Parsers.` — a route handler that knows Settings has an Import
Parsers tab. The sentence now lives in `copy/errors.ts` and the route says `NO_PARSER_MATCHED`.

**The plural splice had survived in the backend**, because story 2's repo-wide ban only scans
`frontend/src`. `this account has ${entries} ${entries === 1 ? 'entry' : 'entries'}` was the
last one; it is now `ACCOUNT_HAS_ENTRIES` with a count, and both readings are prose in the
copy file.

**Mobile needed a stopgap.** It renders `body.error` straight into a `<Text>` in eight places,
so shipping codes without it would have put `ACCOUNT_NOT_FOUND` in front of the reader on the
app that gets used while travelling. `mobile/lib/errors.ts` unshouts a code into a plain
sentence until story 9 gives mobile the real catalog.

## What settings and accounts turned up

**311 messages, against an estimate of 97.** The epic's figure counted what a grep for
quoted prose could see in three directories. The real surface is 266 entries in
`copy/accounts.ts` and 45 in `copy/settings.ts` — the issue's own re-count (214 in the
components directory alone) was the closer guess. Story 5's 166 should be read the same way.

**The check could not see a tooltip or a hint.** `tooltip="Go deeper"` and
`hint="Blank falls back to the path."` are component props, not HTML attributes, so the
markup scanner walked straight past them — twenty-eight strings that were found by reading
the files rather than by running the test. The scanner now reads this app's own word-bearing
props alongside `title` and `aria-label`.

**The check could not see a `.ts` file at all.** It read `.svelte` and nothing else, and the
words in this surface were not all in markup: `accountRoles.ts` held the tooltip on every
role chip *and* the only sentence explaining why a hide button is greyed out,
`balanceLabel.ts` held `OWING` and `IN CREDIT`, and `categoryTree.ts` held the four
validation messages you get while typing a category path. A markup-only check would have
certified the surface converted with all of it still in place. `CONVERTED` now covers every
non-test `.ts` module in a converted directory.

**A splice wearing whole words.** `protectionMessage` inflected its own middle:
`` `Point ${names} at another account in Settings first — ${subject} in use.` `` with
`subject` a ternary between `'this is'` and `'these are'`. Story 2's ban only matches
inflectional endings, so it sailed through — but it is the same shape, and the fix is the
same: two whole sentences behind `plural`.

**A label glued to a verb.** Settings confirmed each saved pointer with
`` `${defaultLabels[field]} saved` ``, which meant the sentence the user reads —
"Uncategorized account saved" — appeared nowhere in the source. Unfindable when you want to
edit it, and unreachable for any language that does not end on the verb. Each row now owns
its confirmation.

**One sentence wrapped around a path.** The delete-category dialog read
``Delete `expenses:x`? It has no entries and nothing filed beneath it.`` — prose either side
of an interpolation, which is the splice with a value in the middle instead of a ternary.
The path moved to its own line, matching the rename dialog directly above it. This is the
story's one rendered change.

**A placeholder that was really a default.** The four root-path fields fell back to
`'assets'`, `'liabilities'`… in the value and typed the same word again in the placeholder,
one copy of each per field, none of them connected to `DEFAULT_ROOTS` where the real
defaults live. They read from it now — the placeholder was never copy, it was the value.

## Appendix: plural splice sites

Done in story 2. The sites are recorded by treatment rather than by line number, which
went stale within a week of the epic being written. `copy.test.ts` now bans the idiom
across every `.svelte` file rather than only the converted ones — unlike the rest of the
epic this is not a preference a second locale would make expensive, it is a shape a second
locale cannot express at all, so it is cheaper to ban it now than to remove it twice.

**Reworded to `label: value`** — `ImportConfirmStep`'s notes list, all four rows. The
count moved to the end (`Skipped as duplicates: 3`), which drops the plural entirely and
makes the one row that never had a splice (`3 skipped by hand`) read like its neighbours.

**Kept both readings, via `plural`** — everywhere else, about thirty sites across the
import wizard, accounts, catch-up, spending, transactions and Fish Pie. One of them
(`GroupRightPanel`'s delete dialog) was missed by every grep that produced this appendix,
because its `!== 1` wrapped onto the next line; the repo-wide check added in this story
found it. That is roughly the argument for the check. Four of them were
already whole-clause ternaries with a shared tail spliced on after (`'One account has'` …
`no starting line, so nothing they hold is counted below`); those now carry the tail in
both readings, so the singular says *it holds* rather than *they hold*.

Two sentences restructured rather than duplicated, because they had markup mid-sentence:

- `CategoriesTab`'s rename dialog leads with the paths and follows with the count
  sentence, instead of wrapping `<strong>` around a count inside the sentence. The bold
  on the number is gone.
- `ImportPreviewPanel` splits the currency list and the instruction into two sentences,
  so `map it` / `map them` is a complete sentence rather than a pronoun spliced onto a
  `{#each}`.

**Deferred, deliberately** — `CategoriesTab.svelte`'s
`unit={section.entries === 1 ? 'entry' : 'entries'}`. `SheetBand` renders `total` and
`unit` as two separately-styled spans, so this is a figure and its unit (the same slot
holds `CAD`), not a sentence with a noun in it. De-splicing it means changing the
component's props, which belongs to story 4 where the accounts surface is extracted.

Not splices, left alone: `AccountPicker`'s keyboard handling, `RuleTargetEditor`'s
single-group shortcut, `QuickEntryPanel`'s row striping, and the bulk-import tooltip that
picks between two complete sentences on selection count.
