# Epic: Honest Chrome

**Depends on:** `DESIGN.md` §2 (the case/work rule) — this epic is that rule applied to
the case for the first time.

Goal: make every widget in the window chrome do something real, and finish the Graphite
costume by removing the two XP-era leftovers still wearing it. Small, entirely visual,
ships as one coherent change to how the app presents itself.

## UX brief

- **Question this screen answers:** "what is this program, and what still needs me?" — the
  chrome's job, on every screen.
- **Inbox role:** the status bar becomes the app's single always-visible report of how
  current the data is — filled in by Trust Signals story 4, not by this epic.
- **Primary action + interaction count:** the chrome has no primary action. The measure here
  is that it costs zero interactions and never lies.
- **Case or work:** entirely case.
- **Existing patterns reused:** `ChromeButton`, `ConfirmDialog`, the status bar, the tooltip
  action in `$lib/tooltip.ts`.
- **Patterns being stretched or replaced:** the hand-rolled quit dialog in `+layout.svelte`
  (its own `.dialog-*` styles, parallel to `ConfirmDialog`) is replaced or justified.
- **What gets deleted:** the minimize button, the `window.close()` path, the hand-rolled
  dialog markup, `-webkit-font-smoothing: none`, and the Win32 tooltip tokens.

## Background

`DESIGN.md` §2 splits the UI into the **case** (anything that would exist with zero
transactions — frame, titlebar, status bar, sidebar, section headers, tooltips) and the
**work** (everything that exists because you have data). The case is held strictly to 2003
Mac OS X Graphite, and it carries one extra obligation: it must be honest. Every widget in
the chrome does something real, or it isn't there. A decorative control doesn't read as
whimsy — it teaches the user the frame is fake, which retroactively makes the parts that
*do* work feel like set dressing.

The chrome currently fails that on four counts, all in `frontend/src/routes/+layout.svelte`
and the token/base stylesheets.

**Minimize does nothing.** The `ChromeButton variant="minimize"` has no `onclick` at all.
It renders, it hovers, it presses, and nothing happens. It is the single clearest example
of the problem.

**Close is a dead end wrapped in a scary question.** It opens "Are you sure you want to
quit? Changes are saved." and, on Yes, calls `window.close()` — which browsers ignore for
any tab the script didn't open. So the most prominent control in the app asks an alarming
question and then silently fails. Worse, it's the one place the app raises the stakes of a
click that has no consequence.

**The status bar has said "Ready" since it was written.** It is the best real estate in the
case: always visible, structurally part of the metaphor, and already doing genuine work as
the toast surface. Under the inbox model (§1) it has an obvious tenant — the count of what
still needs the user. `actionRequiredStore` and `fetchCatchUp().summary.accountsToCatchUp`
already compute exactly that.

**Two XP leftovers are still in the Mac costume.** `--color-tooltip-bg: #ffffe1` with a 1px
black border is the Win32 tooltip, verbatim. And `base.css` sets
`-webkit-font-smoothing: none` for "crisp pixel rendering" — an XP-era instinct fighting its
own reference, because Aqua was precisely the era that introduced aggressive font smoothing.
That one line is a large part of why the type reads Windows while everything around it reads
Mac.

Maximize is fine and stays: it toggles the window between inset and full-bleed, which is a
real thing a real control does.

## Design decisions

**Close signs you out.** "Quit" has no meaning in a browser tab, but the button is at the
top right of a window and everyone knows what it means, so the honest move is to give it the
nearest true meaning rather than delete it. Signing out is the app's actual exit.

**Close keeps its dialog; nothing else gains one.** P4 prefers undo over confirm, and signing
out is technically reversible — you log back in. But a misclick that discards an
in-progress import session or a half-entered transaction costs real work, and there is no
undo for "I was in the middle of something." This is the narrow case where a confirm earns
its interruption. The dialog's copy changes from the misleading "quit" language to what
actually happens.

**Minimize is deleted, not implemented.** The alternative — collapsing the window to the
status bar — is cute for about four seconds and then it's a state you have to design an
escape from, on desktop and on mobile, forever. The case is honest either way; deleting is
honest and free.

**The status bar reports, it does not nag.** It shows the outstanding count as a quiet
statement ("3 accounts to catch up"), not a badge, not a colour, not an alert. When the
count is zero it says so — that's the win condition from §4's cleared empty state, and the
status bar is where the app gets to acknowledge it. Toasts still take precedence when one
is showing; the count returns when it clears.

**The tooltip goes Aqua, not modern.** Tooltips are case, so they are period — a soft dark
translucent panel with a subtle border and rounded corners, not a flat modern popover and
not Win32 yellow. New tokens, and a contrast assertion in `tokens.test.ts` for both themes
since it's a new fg/bg pair.

**Font smoothing comes back on.** Expect this to change the feel of every screen — it is the
single highest-leverage line in the epic and worth looking at before and after in both
themes. If Lucida Grande at 13px turns mushy with smoothing on, the answer is
`antialiased`, not a return to `none`.

## Stories

### 1. Honest titlebar controls

`frontend/src/routes/+layout.svelte`.

Delete the minimize `ChromeButton` entirely. Rewire close to sign out via Better Auth,
replacing the `window.close()` path. Rewrite the dialog: title stays the app name, body says
what will actually happen ("Sign out of have-fish?" / "Any unsaved entry on this page will be
lost."), actions become "Sign out" and "Cancel" rather than "Yes"/"No" — a labelled verb is
what makes a dialog answerable without reading the question twice.

The dialog is currently hand-rolled markup inside `+layout.svelte` with its own
`.dialog-*` styles. Move it to `ConfirmDialog` if it fits without stretching that component;
if it doesn't, say so in the PR rather than adding a mode prop (§6).

Keep maximize as-is.

**Tests:** the sign-out path calls the auth client and redirects; cancel leaves the session
alone; no control renders without a handler (a cheap render-level assertion that every
`ChromeButton` in the titlebar has an `onclick`).

### 2. The status bar carries the trust readout

**Shipped in `planning/epics/trust-signals.md` story 4.** Nothing to build here.

This story originally put an inbox count in the status bar. Two problems surfaced while
scoping it. A bare queue count has an ambiguous zero in a manual-entry app ("caught up" and
"haven't imported in three weeks" look identical), and the two candidate numbers
(`accountsToCatchUp` versus the `actionRequired` total) are different quantities that would
disagree in the one line available. The completeness date answers the same question honestly
and degrades to "Complete through today" when caught up.

Ship Honest Chrome stories 1, 3 and 4 without touching the status bar's content; Trust
Signals replaced "Ready" with the trust readout. The two epics are independent in every
other respect.

<details>
<summary>Original story text, kept for the reasoning</summary>

### The status bar carries the inbox count

`frontend/src/routes/+layout.svelte`, `frontend/src/lib/actionRequired.svelte.ts`.

Replace the static "Ready" with the outstanding count. Source it from the catch-up summary
(`accountsToCatchUp`) plus whatever `actionRequiredStore` totals across accounts — decide in
the story which single number is the honest one and write down why; two competing counts in
one line is worse than either.

States: loading (empty, no layout shift), `n > 0` ("3 accounts to catch up"), zero ("All
caught up"). Clicking it navigates to `/catch-up`. A live toast still wins the space and the
count returns when it expires.

The count must invalidate when work is done — after an import commits, after a
reconciliation, after a transaction is added. `actionRequiredStore.invalidate()` exists;
wire the callers that currently don't use it.

**Tests:** the three display states; the click target; invalidation fires from the mutation
paths.

</details>

### 3. An Aqua tooltip

`frontend/src/styles/tokens.css`, `frontend/src/styles/base.css`, `tokens.test.ts`.

Replace the Win32 yellow with a period-appropriate Aqua tooltip in both themes: dark
translucent panel, hairline border, `--radius-sm`, `--shadow-window`. Update
`--color-tooltip-bg` / `-border` / `-text` and the `.hf-tooltip` rule in `base.css`.

**Tests:** add a contrast assertion to `tokens.test.ts` for tooltip text on tooltip
background in light and dark — 4.5:1, it's body text.

### 4. Turn font smoothing back on

`frontend/src/styles/base.css`.

Remove `-webkit-font-smoothing: none`. Look at every primary screen in both themes and both
extremes of the accent range before calling it done; attach before/after screenshots to the
PR, because this is the one change in the epic that can't be reviewed from a diff.

If the result is genuinely worse at 13px, fall back to `antialiased` and record the finding
in `DESIGN.md` §5 as a deliberate exception — but `none` does not come back.

## Out of scope

- The sidebar's nav order (leads with nouns, not the loop) — its own epic.
- Modal nesting — its own epic.
- Anything in the work half of §2.
