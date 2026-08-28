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

**Sections, not tabs — for now.** Three sections of two to four rows each. Tabs for three
short sections is more chrome than content: you would click a tab to reveal two rows.

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
  small change to the shell and none to the rows, which is why it is safe to defer.

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

Add `defaultCurrency` to the **Display** section, writing the same
`PATCH /api/accounts/:id { defaultCurrency }` that `QuickEntryPanel` already writes.

Quick Entry keeps its own selector — it is the right control in that flow, and changing it
mid-entry should still stick. Both write the same field, so the modal simply stops being the
only place that cannot reach it.

### 4. The catch-up section

The first editing UI for the cycle model, calling `updateCoverageConfig`.

- **Tracked** — a toggle. Untracking here should read the same as the hub's "stop tracking".
- **Export mode** — `range` or `cycle`.
- **Cycle day** (1–31) and **release lag** (days) — rendered **only** when mode is `cycle`.
- Each field can be cleared back to inference: the endpoint takes `null` per field to drop an
  override, so the UI needs an explicit way to say "back to automatic" rather than treating a
  blank as zero.
- Show what inference would pick when a field is on automatic, the way the type row already
  shows `Auto (inferred: …)`.

Tests: the value ↔ override mapping is the part worth pinning — clearing to `null`,
distinguishing "automatic" from a real `0` release lag, and clamping `cycleDay` to 1–31.

## Out of scope

- **Deleting or archiving an account.** Destructive, rare, and it raises a question this epic
  does not answer (what happens to the postings). A destructive action also sits badly in a
  modal where everything else commits the moment you touch it — it would need its own
  confirmation and visual separation. Worth its own epic.
- **Starting balances.** Creates a transaction; see the admission rule above. Already has
  [its own epic](starting-balances.md).
- **The tab restructure.** Deferred until the trigger above fires, so the shell is not built
  for a size it may never reach.
- **Account path renaming.** Lives in `/accounts/manage` with cascade semantics this modal
  should not duplicate.
