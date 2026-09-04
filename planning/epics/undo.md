# Epic: Undo

**Depends on:** nothing. **Unblocks:** `DESIGN.md` P4, which currently asserts a preference
the codebase cannot act on.

Goal: make destructive actions recoverable, so "prefer undo to confirm" stops being a bluff.
Action-scoped undo in the status bar — one action, one reversal, offered at the moment of
the mistake.

## UX brief

- **Question this screen answers:** not a screen — a law. "Can I take that back?"
- **Inbox role:** none directly, though it lowers the cost of clearing the inbox fast, which
  is the point of the inbox model.
- **Primary action + interaction count:** undo is one click (or `Cmd/Ctrl+Z`) within the
  window. The win is on the other side: every delete that loses its confirm dialog drops
  from two interactions to one.
- **Case or work:** the affordance is case (status bar); the flows it protects are work.
- **Existing patterns reused:** the status bar as notification surface (§2), soft deletes,
  `ConfirmDialog` for the actions that keep one.
- **Patterns being stretched or replaced:** `toast.svelte.ts` is replaced outright; every
  call site migrates in this epic. The accounts page's in-flow bulk bar becomes a floating
  tray — the first instance of the §2 pattern, so build it to be lifted into `ui/` when a
  second surface needs one.
- **What gets deleted:** the string-and-timer toast store, the confirm dialogs on in-scope
  deletes, 17 error-carrying `toast.show()` calls, and the in-flow `.bulk-bar` card (the
  card is already gone — story 6 shipped early; see there).

## Background

P4 says a confirm dialog taxes every user on every action to protect against a rare
misclick, and that undo is the better trade. That argument only holds if mistakes are
actually recoverable. Today they are not.

The schema is already built for this: soft deletes throughout, `deletedAt` timestamps,
`null` meaning active — the deleted row is sitting right there. But across eleven
`app.delete` handlers in `backend/src/routes/`, there is not a single restore path. Nothing
that goes can come back, from the API or the UI.

The notification layer can't express it either. `frontend/src/lib/toast.svelte.ts` is a
string and a timer:

```ts
show(text: string, duration = 2500) {
  message = text
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { message = null }, 3200)
}
```

No action slot, and the `duration` argument is accepted and then ignored in favour of a
hard-coded 3200ms — every caller that passes one is being lied to.

It is also carrying traffic it shouldn't. Of 46 `toast.show()` call sites, 17 are failures
— "Failed to rename category", "Failed to update split", "Could not create that account".
§4 says errors appear next to the thing that failed and persist;
these appear in a status bar the user isn't looking at and evaporate in 3.2 seconds. That
is a shipped violation, and it lives in the component this epic has to rewrite anyway.

## What "undo" means here

Three things get called undo. This epic is the first one only.

1. **Action-scoped undo** — a single reversal offered immediately after a specific action,
   with a short window, then gone. "Deleted Fresh Market — $84.20. Undo." **This is the
   epic.**
2. **An editor-style undo stack** — multi-level `Cmd+Z` across a surface. Not this. It wants
   a client-side command model over a server-backed store, which is a large amount of
   machinery for a chore app.
3. **Version history / audit revert** — every record restorable to any prior state. Not
   this, though the soft deletes are the raw material if it's ever wanted.

## Design decisions

**Undo restores; it does not replay.** The reversal sets `deletedAt` back to `null` on
exactly the rows the delete touched. No re-creation, no new ids — anything holding a
reference to the record still resolves after an undo. This is why soft deletes make the
epic cheap.

**Restores are guarded by a window, not open forever.** A restore endpoint that will
resurrect anything ever deleted is a liability once there are more users. Each restore
accepts only records deleted within a short window (10 minutes is generous for a UI
affordance that lives 8 seconds) and 410s otherwise, with a message the UI can show. This
also means a stale browser tab can't undo something from last Tuesday.

**Restore is guarded by preconditions, and says so when it can't.** Restoring is not always
safe: an account whose path was reused, a Fish Pie expense whose settlement has since been
recorded. Each restore endpoint validates that the world still admits the record and returns
a specific refusal when it doesn't. The UI reports the refusal in place — it does not
silently do nothing.

**Not everything gets undo.** Deleting an account with history is rare, deliberate, and
expensive to get wrong; it keeps its confirm dialog. Undo is for the actions that happen
often enough that a dialog is a tax: transactions, postings, Fish Pie expenses, import
rules, categories. The split is written into the epic and into `DESIGN.md` P4 so the next
person doesn't have to re-derive it.

**One undo at a time.** The status bar holds one message. A second undoable action replaces
the first, and the first becomes unrecoverable through the UI. A queue would be more
capable and would also mean the user can't tell what "Undo" refers to — which defeats the
point of an affordance you're meant to hit without reading.

**Errors leave the status bar.** Field-level failures move next to their field as part of
story 4. The status bar keeps transient *outcomes* — what happened, and how to take it back.

## Stories

### 1. Rewrite the notification store

`frontend/src/lib/toast.svelte.ts`, `frontend/src/routes/+layout.svelte`.

Replace the string-and-timer with a proper store: a message, an optional action
(`{ label, run }`), an honoured duration, and an explicit `dismiss()`. Fix the ignored
`duration` argument. When an action is present the timer pauses on hover and on focus —
an 8-second window the user is reading is not an 8-second window.

Render it in the status bar: message on the left, action as a text button. Keyboard-reachable
and labelled; `Cmd/Ctrl+Z` triggers the pending action while one is showing (§4 gives
shortcuts to anything used more than once a session, and this is the shortcut everyone tries
first).

The shortcut is the primary affordance and the button is the fallback, so the message names
it — "Deleted bank:savings:czk. Undo ⌘Z" — which both teaches the shortcut and stops the
action being something the user has to hunt for in a thin strip. Two supports for that, per
§2 and §5:

- **The status bar gets its permanent height** here: ~28–32px, so the action clears WCAG
  2.5.8's 24×24 minimum. Paid once, never animated. The bar must not resize when it gains or
  loses an action — that's the §2 rule, and it's why the height goes in as a constant rather
  than growing to fit.
- **A single background pulse** when the bar gains an action. Motion that catches the eye
  without moving the frame, and gated on `prefers-reduced-motion`.

Migrate all existing `toast.show()` call sites unchanged — same behaviour, new store. No
call site keeps the old shape (§6: the old thing is deleted in this epic).

**Tests:** duration is honoured including the argument; hover and focus pause the timer;
action fires on click and on the shortcut; a second message replaces the first and cancels
its action; dismiss clears both.

### 2. Restore endpoints

`backend/src/routes/transactions.ts`, `postings.ts`, `fish-pie-expenses.ts`, `rules.ts`, and
their tests.

Add `POST /:id/restore` alongside each soft delete in scope. Each one: authorises by owner,
clears `deletedAt` on the record and its dependent rows in the same transaction, enforces
the recency window, validates the preconditions above, and returns the restored record.

Fish Pie expenses are the interesting one — restoring re-opens a balance, so the endpoint
must refuse if a settlement has been recorded against the group since the delete, and say
which settlement.

**Tests, per resource:** restore round-trips and the record reappears in list endpoints;
dependent rows come back together; a restore outside the window 410s; a restore by another
user 404s; an already-active record is a no-op rather than an error; the precondition
refusals, each with their specific message. Balance-affecting restores assert the balance
returns to its pre-delete value.

### 3. Wire undo into the delete flows

Frontend, wherever the in-scope deletes are triggered.

Every in-scope delete becomes: optimistic removal from the list, status-bar message naming
what went ("Deleted Fresh Market — $84.20"), Undo action calling the restore endpoint and
putting the row back. A failed restore reports why in place.

Remove the confirm dialogs these deletes had; `CategoriesTab`'s `ConfirmDialog` is the one
current call site and should be reviewed against the split above rather than reflexively
removed.

**Tests:** optimistic removal and restoration; the undo path on each surface; a failed
restore surfaces its reason and leaves the list correct; deletes that keep their dialog
still have it.

### 4. Field errors move out of the status bar

Frontend, the 17 failure-carrying `toast.show()` call sites.

Move each to an inline error next to the control that failed — persistent until the user
acts, in plain language, saying what to do next. `CategoryManager` (6 sites) and
`CategoriesTab` (5) are the bulk. Two are partial-success warnings rather than errors
("Imported, but the covered range could not be recorded") — those stay transient but should
say what the user can do about it, which they currently don't.

**Tests:** a failing mutation renders an inline error and leaves the field editable with the
user's value intact; success clears it.

### 5. Undo for bulk assignment

`frontend/src/routes/(authed)/import/+page.svelte`, `ImportSortStep`.

The highest-value undo in the app and the one with no delete behind it: "142 rows assigned"
is a single click that rewrites a screenful of work, and there is currently no way back
short of re-sorting by hand.

This is a client-side reversal of pending session state, not a server restore — the sort
step's assignments live in the import session before commit. Snapshot the affected rows
before the bulk write, offer "Undo" in the status bar, restore the snapshot on click.

Do not extend this to a committed import. Reversing a commit is a different feature with
different stakes and belongs to its own epic if it's ever wanted.

**Tests:** a bulk assign followed by undo restores the exact prior assignment for every
affected row and leaves untouched rows alone; undo after a subsequent edit is either
correctly scoped or unavailable — pick one in the story and assert it.

### 6. The bulk selection tray — shipped ahead of this epic

**Done.** Pulled forward out of order: the in-flow bar turned out to be the trigger for a
repaint failure on the accounts page (ticking a group checkbox while scrolled down left most
of the window unpainted), so the fix shipped on its own rather than waiting for undo. The
tray is `frontend/src/lib/components/ui/SelectionTray.svelte`. The one part of this story
still outstanding is the last test below — the tray coexisting with a live status-bar undo,
which cannot be written until stories 1–3 give the status bar an undo to show.

`frontend/src/routes/(authed)/accounts/+page.svelte`.

The account list's bulk bar is a `Card` in normal document flow above the account groups, so
checking a box pushes the whole table down ~60px — and unchecking pulls it back. It is the
worst layout shift in the app and it fires on the most incidental interaction there is.

Move it to a tray anchored to the bottom of the scroll container: `position: sticky`, list
scrolling underneath, nothing displaced. This is §2's rule — contextual controls float over
the work, they don't live in the case and they don't sit in the flow. Two things follow from
floating rather than squeezing into the status bar:

- The tray can be ~48px with 32px targets, instead of controls crammed into a 28px strip.
- It coexists with the status bar. "Hide all" on 11 accounts leaves the tray up *and* offers
  undo below it. Sharing one surface would mean a priority fight every time a bulk action
  completes while a selection is still live.

Keep the existing behaviour: `Esc` clears, the count is authoritative, rows that leave the
view take their selection with them (already handled in `visibleRows`/`selection`). The tray
gains a shadow only when content is scrolled beneath it, so it reads as floating rather than
welded on — `scrollShadow.ts` already does this elsewhere.

**Tests:** the tray mounts and unmounts without changing the scroll offset or the height of
any row; `Esc` clears the selection; bulk actions still act on exactly the visible selection;
the tray and a live status-bar undo can be shown at once.

### 7. Write the rules back into DESIGN.md

Update P4 with the actual split — which actions get undo, which keep a confirm, and why.
Strike from §10: "no undo anywhere", "the toast timer is wrong", the 17 failure-carrying
toast calls, the in-flow bulk bar, and the 20px status bar.

## Out of scope

- Multi-level undo, `Cmd+Z` history, version history.
- Reversing a committed import.
- Undo on mobile (`mobile/` has no status bar; it needs its own affordance and its own epic).
