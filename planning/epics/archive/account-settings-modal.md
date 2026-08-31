# Epic: Account Settings Modal

**Depends on:** Account Page Redesign (ships the More menu this opens from).

Goal: Move account settings out of the in-page panel and into a modal, and make that modal
the one home for per-account configuration — including two groups of settings that are
currently unreachable or reachable only by accident.

## Background

Account settings today are an inline panel that expands between the toolbar and the
transaction list, pushing the ledger down. The Account Page Redesign epic left it alone and
flagged it as worth revisiting; this is that revisit.

The panel holds three settings, and they already save three different ways:

| setting | saves | endpoint |
|---|---|---|
| Display name | explicit **Save** button (Enter saves, Escape reverts the field) | `PATCH /api/accounts/:id` |
| Type | on change, no button | `PATCH /api/accounts/:id` |
| Sidebar visibility | immediately on toggle | `PATCH /api/user-settings` |

Inline, that inconsistency is invisible — there is no boundary, so nothing implies a commit.
A modal creates one, and the mismatch turns into a lie: `Modal` closes on Escape, and
`AddTransactionModal` sets the house expectation that a modal carries **Cancel**. A Cancel
here could not undo the type change or the visibility toggle, because both are already on the
server by the time you press it.

Two more per-account settings have no proper home at all:

- **`defaultCurrency`** is settable only from the Quick Entry panel's currency dropdown
  (`QuickEntryPanel.svelte`) or at account creation. If you never open Quick Entry, you
  cannot change it.
- **`exportMode` / `cycleDay` / `releaseLag`** have a working endpoint —
  `PATCH /api/coverage/config/:accountId`, shipped in the Catch-Up Coach epic — and no
  editing UI whatsoever. The only caller is the catch-up hub's "stop tracking" action,
  passing `tracked: false`. The whole statement-cycle model is inferred-or-default with no
  way to correct it by hand, which is a gap rather than a deliberate omission: the coach can
  only rank a mis-modelled account lower, never let you fix the model.

Also worth fixing on the way past: `save()` and `saveType()` are `try`/`finally` with no
`catch`. A failed PATCH rejects unhandled and the UI silently does nothing. That is tolerable
behind an explicit Save button; it is not tolerable once every control saves on its own.

## Design decisions

**Immediate save, and no Cancel.** Every control commits on change. The modal's only action
is Close. This is the modern settings convention (macOS System Settings works this way), and
it avoids a three-endpoint transaction — the settings here span `accounts`, `user-settings`,
and `coverage/config`, so a transactional modal would have to commit across all three and
handle "name saved, visibility failed".

The cost is that immediate saves need acknowledgement, or they feel broken. Every row gets a
save-state affordance, which is also where the missing error handling lands.

**Free text commits explicitly.** "On change" is well defined for a select or a toggle, which
fire an event the moment the user decides. Typing fires nothing that means "I meant that".
Blur is the obvious proxy and a poor one: it fires on tab-away and on switching windows, and
it does not fire on Escape. So the name field commits on Enter, or on a **Save that appears
only once the value differs from the server** — it is not standing chrome, and its presence is
what tells you something is uncommitted.

**Escape closes the modal, and closing discards an uncommitted name.** Today Escape in the
name field reverts it. In a modal, Escape means close, and two meanings for one key is worse
than losing the revert. With an explicit commit the two collapse into one behaviour: closing
by any route — Escape, the close button, the backdrop — drops the pending edit and reopening
shows what the server holds. That is honest rather than lossy, because an uncommitted edit is
one the user was being shown an unclicked Save for.

**Sections first, then tabs.** Three sections of two to four rows started as a single stacked
column, on the grounds that tabs for three short sections is more chrome than content. Story 4
settled it: with the catch-up rows in place the modal ran past a 720px viewport, so the trigger
below fired and the sections became a tab strip.

**Guarding against the balloon.** This modal is meant to absorb settings over time, so it
needs a rule rather than good intentions. A setting belongs here only if all three hold:

1. it is about **the account itself**, not about a view of it;
2. it is changed **rarely** — set once and mostly forgotten;
3. it has **no better home in a flow** the user is already in.

Worked examples of what that excludes: the date range, sort order and currency conversion
toggle fail (1) — they are view state and belong in the toolbar. A starting balance fails (1)
too: it creates a transaction, so it is an action, not a setting. Anything you would touch
weekly fails (2) and belongs where the work happens.

Two structural rules keep it honest:

- **Conditional rows.** A setting that is meaningless given another setting's value is not
  rendered. `cycleDay` and `releaseLag` appear only when `exportMode` is `cycle`, which takes
  the common case from eight controls to six.
- **A stated trigger for restructuring.** When a fourth section is added, or the content
  exceeds one viewport at 720px height, the sections become a tab strip (period-accurate for
  the Aqua shell — System Preferences and Finder's Get Info both work this way). That is a
  small change to the shell and none to the rows, which is why it was safe to defer.
  **Fired after story 4** — see story 5. The trigger now reads: a fifth tab, or any one panel
  outgrowing the fixed panel height.

**Three endpoints, three independent saves.** Nothing batches. Each row owns its request and
its own error state, so one failure cannot take another setting down with it.

## Stories

### 1. `SettingRow` and save-state feedback

The primitive everything else sits on. `frontend/src/lib/components/accounts/SettingRow.svelte`:
label on the left, control snippet on the right, save-state affordance after the control.

- States: `idle` → `saving` → `saved` → back to `idle` after ~1.5s; or `error`, which persists
  until the next attempt.
- `saved` is a check icon plus "Saved" in `--color-text-muted`; `error` is the message in
  `--color-danger` with a retry affordance. Both sit inline so a row never changes height and
  the modal does not jump as rows settle.
- Respect `prefers-reduced-motion` for the fade.
- A pure `frontend/src/lib/components/accounts/saveState.ts` holds the transition logic and
  the error message extraction, so the timing and the wording are testable without a DOM.

Tests: the state machine — idle→saving→saved, the auto-clear, saving→error, error surviving
until the next save, and a second save landing while the first is still in flight.

### 2. The modal shell, with the three settings that exist today

`frontend/src/lib/components/accounts/AccountSettingsModal.svelte`, wrapping the existing
`Modal`. Sections **Identity** (display name, type) and **Display** (sidebar visibility).

- Name saves on Enter or its Save affordance; type on change; visibility on toggle. Every one
  of them goes through `SettingRow`, so all three report the same way.
- **Add the missing `catch`** on both account PATCHes and route failures into the row's error
  state.
- Closing discards a pending name edit; reopening resyncs from the server.
- Delete `AccountSettings.svelte`, the `settingsOpen` state on the account page, and the
  inline panel's slot in the layout. The More menu item opens the modal instead.
- Check it at 520px: `Modal` is `min-width: 300px`, so the section rows need to stack rather
  than squeeze.

Tests: covered by story 1's helper plus a smoke test that the modal renders each section.

### 3. Default currency joins the modal

Add `defaultCurrency` to the second section — renamed **Preferences**, because both rows in it
are choices about how the app treats the account rather than facts about it, and a currency
that pre-selects on entry is not a display concern.

It writes the same `PATCH /api/accounts/:id { defaultCurrency }` that `QuickEntryPanel`
already writes. Quick Entry keeps its own selector — it is the right control in that flow, and
changing it mid-entry should still stick.

A select rather than Quick Entry's combobox, because this is the one place that has to express
**unset**: `null` means "no pin, fall back to the user's preferred currency", and a free-text
currency box cannot say that without treating a blank as an error. Same shape as the type row's
"Auto".

The route needs a fix on the way past: `defaultCurrency` was passed through unvalidated on both
the create and update paths, so any string was stored verbatim in a plain text column and every
later FX lookup would fail on it. `currencies.ts` claims "all writes that include a currency
code are validated against this set" — this route was the exception.

### 4. The catch-up section

The first editing UI for the cycle model, calling `updateCoverageConfig`.

- **Tracked** — a toggle. Untracking here reads the same as the hub's "stop tracking".
- **Statements** — `range` or `cycle`.
- **Cycle day** (1–31) and **release lag** (days) — rendered **only** when the effective mode
  is `cycle`.
- Each field can be cleared back to inference: the endpoint takes `null` per field to drop an
  override, so every control is a **select with an explicit "Automatic" option** rather than a
  number box. That makes "automatic" a choice instead of a blank — which is what keeps a real
  `0` release lag distinct from no override — and makes the 1–31 bounds structural rather than
  validated.
- Each automatic option names what it resolves to, the way the type row shows
  `Auto (inferred: …)`.

Two things the endpoint forced that were not obvious when this was scoped:

**The GET had to start returning `override` and `inferred`.** It returned only the merged
`config`, which cannot say whether a value was pinned or inferred — and "hand this back to
automatic" is unofferable without knowing. `inferred` is needed too: once a pin is in place,
inference's own answer is lost from `config`, so the automatic option could not name what it
would restore.

**`exportMode` and `cycleDay` are not independent.** The route refuses a cycle account with no
cycle day, on purpose — it would otherwise behave exactly like a range one while claiming not
to. So choosing "statement cycle" on an account with no inferred day cannot fire its own PATCH:
the day row is revealed and the two commit together once it is answered. That is not an error
state — it is an unfinished choice, and it says so in a neutral note rather than borrowing the
error's red and its Retry button.

Tests: `planCycleCommit` pins the mode/day interlock in every direction, and `toDayChoice` pins
the trap the AUTOMATIC sentinel exists for — `Number('0')` is falsy, so any truthiness check at
the select boundary would silently clear the override instead of pinning same-day release.

### 5. Sections become tabs

The trigger fired: with the catch-up rows in, the modal ran past a 720px viewport, and
scrolling to reach a setting costs more than clicking to reach it.

- `frontend/src/lib/components/ui/TabStrip.svelte` — Aqua folder tabs, the same shape the
  spending page already uses, so the app has one tab language rather than two. It adds what the
  ad-hoc one lacks: a roving tabindex, arrow/Home/End navigation with focus following the
  selection, and full `aria-controls`/`aria-labelledby` wiring.
- **Tabs hide panels, so an error can now be one click out of sight.** Each tab carries a
  marker when any row behind it is in error — the one thing the stacked layout gave for free.
- **The panel is a fixed height**, sized to the tallest. The window is centre-anchored, so a
  shorter panel would not merely shrink the box, it would slide the tab strip up under the
  pointer that just clicked it. Some empty space under a two-row tab is the price of a window
  that holds still.
- The catch-up tab is **absent**, not disabled, for an account the coach does not track; if the
  account's type changes out of the coach's reach while the tab is open, it falls back.
- Reopening starts at the first tab, for the same reason it resyncs every control: resuming
  mid-way would resume into state that no longer necessarily holds.

## Out of scope

- **Deleting or archiving an account.** Destructive, rare, and it raises a question this epic
  does not answer (what happens to the postings). A destructive action also sits badly in a
  modal where everything else commits the moment you touch it — it would need its own
  confirmation and visual separation. Worth its own epic.
- **Starting balances.** Creates a transaction; see the admission rule above. Already has
  [its own epic](../starting-balances.md).
- **Account path renaming.** Lives in `/accounts/manage` with cascade semantics this modal
  should not duplicate.
