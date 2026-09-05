# DESIGN.md

The design constitution for have-fish. `CLAUDE.md` says how to build; this says what to
build, what it should feel like, and how it is allowed to change.

**Read this before starting any epic that touches the UI**, before adding a component to
`frontend/src/lib/components/`, and before deciding an existing pattern is "close enough."

---

## 1. The thesis

**have-fish is an inbox for money, in a case that looks like a 2003 desktop app.**

Personal finance tracking is a chore. Nobody opens this app for fun; they open it because a
week of transactions has piled up and the number in the corner is no longer trustworthy.
The product's job is to make the chore end sooner — to shorten the distance between "I
should update my finances" and "my finances are updated and I believe the numbers."

### The mental model: an inbox you clear

The app knows what is unrecorded. That knowledge is the spine of the product, not a
feature on a side page.

- **The app tells you what needs you; you don't go looking.** Uncategorised imports, stale
  accounts, unreconciled balances, unsettled Fish Pie expenses — these are inbox items, and
  the app surfaces their count before you ask.
- **Zero is the win condition.** "Nothing to record" is a designed, earned, celebrated
  state. Most finance apps have no concept of done; this one does.
- **Every surface can answer "does this need me?"** A screen that holds data but can't
  report its own outstanding work is a screen that made the user do the checking.
- **Navigation follows the loop, not the schema.** What needs me → record it → check it.
  Not: here are your seven nouns, good luck.

The corollaries:

**Entry speed is the primary metric.** Keystrokes and decisions per item are the thing to
optimise. A feature that adds a field to the common path had better remove two elsewhere.
When in doubt, count the interactions — literally, in the epic file.

**Double-entry is an implementation detail, not a UI.** The ledger underneath is real and
correct (it exports to hledger — see the Vision in `CLAUDE.md`). Nobody should have to
think in debits and credits to record lunch. Expose the ledger; don't impose it.

**Trust is earned by being checkable, and by being dated.** Every displayed figure must be
traceable to the rows that produced it in at most two clicks. Never round silently, never
hide a reconciliation gap, never show a total the UI can't explain. A pretty dashboard nobody
believes is worse than an ugly table they do.

In a manual-entry app that obligation extends past correctness to currency. A figure summed
from stale rows is arithmetically right and semantically stale — it answers "the sum of what
you have recorded" beneath a label promising "what you have," and nobody reads it as the
former. So: **a rollup is only as current as its stalest live contributor**, and it says so.
*Live* matters — a dormant account can be months behind without making a total wrong, because
it has nothing to add.

And the hard line that goes with it: **count the gap, never price it.** How many transactions
are probably unrecorded is a fact about coverage, derived from the account's own rate. What
they are worth is a guess about money, and a guess about money displayed beside a real balance
destroys more trust than the staleness did.

One more, which is the ambiguous zero of the inbox model turned on the data itself: **what is
absent from the ledger is not evidence about the world.** An account whose statement was never
imported has no transactions in a period *because* it was never imported, so any judgement made
from the rows that are present will read every neglected period as complete. Coverage is
therefore always judged against every tracked account, never against the accounts that happen
to appear — and an empty result says which kind of empty it is, because "you spent nothing" and
"you imported nothing" are the same screen otherwise.

---

## 2. The material: the case and the work

This is the rule that resolves every "does this belong?" argument about style. It exists
because the app drifted: an XP-yellow tooltip inside a Mac OS X Graphite shell, 999px
pills next to 3px badges, skeleton shimmers under a fake titlebar whose minimize button
does nothing. None of that was wrong on its own. What was missing was a line saying which
parts are period and which parts aren't.

> **The case is period. The work is modern.**

**The case** is everything that would still exist if you had zero transactions: the window
frame, titlebar, status bar, sidebar, section headers, modal chrome, tooltips, menus,
dialog furniture. The case is 2003 Mac OS X Graphite and is held to that standard
strictly — it is what makes the app feel like a program rather than a website, and it is
the part that should feel *made*.

**The work** is everything that exists because you have data: tables, rows, forms, entry
paths, pickers, previews, charts, filters, import steps. The work is governed by modern
interaction design — optimistic updates, skeletons, inline editing, type-ahead,
keyboard-first flows. It is *rendered* in the case's material (same tokens, same type,
same density) but it owes nothing to 2003 behaviour.

**The test:** would this element exist in an empty account? If yes, it's the case and it's
period. If no, it's the work and it's modern.

Three consequences worth stating outright, because each one contradicts something currently
shipped:

**The case must be honest.** Every widget in the chrome does something real, or it isn't
there. A decorative minimize button is the difference between craft and costume — one says
"someone made this," the other says "someone drew this." An inert control teaches the user
that the chrome is fake, which retroactively makes the whole frame feel like set dressing.

**The status bar is the notification surface.** Toasts belong in the status bar, not
floating over the content as a modern snackbar. This is the case doing real work, and it's
the single best thing the metaphor buys us. It also carries live state: the trust readout —
how far the ledger is recorded — is its resting tenant, and a transient message takes the
space and hands it back.

**The case never changes size.** The frame is the one thing in the app that is nailed down;
that is its whole job. A status bar that grows to hold controls, a titlebar that expands, a
sidebar that reflows the content area on its own — each turns the frame into another panel
and takes the app's only fixed reference point with it. Contextual controls therefore never
live *in* the case. They **float over the work**: a tray anchored to the bottom of the
scroll container, content scrolling underneath, nothing displaced. Floating costs nothing
in layout and buys room for honest hit targets, which a 30px strip cannot give you.

The tempting version of this mistake is subtle, so it's worth naming: `.window` is a column
flex with `.window-body` at `flex: 1` and `.content` owning the scroll. Growing the status
bar therefore shrinks the *viewport* rather than pushing rows down — better than inserting a
bar into the flow, and still wrong. The scroll container resizes mid-interaction, the
scrollbar thumb jumps, and anything anchored near the bottom shifts. A floating tray resizes
nothing at all.

**Period does not mean inconvenient.** The case constrains how things look, never how many
steps something takes. No nested modals, no five-field dialogs, no OK/Cancel where inline
editing works, no 2003 information architecture. If someone argues for a worse interaction
on grounds of period accuracy, the answer is no.

---

## 3. Principles

Each principle has a test. If you can't apply the test, the principle isn't doing work.

### P1 — The common path is the fast path
The 80% action on any screen is reachable without a modal, a menu, or a scroll.
*Test:* name the single most frequent action on the screen. Count the interactions to
complete it from a cold page load. More than three means the screen is wrong.

### P2 — Never ask for what you can infer
Dates default to today or the last-used date. Currency defaults to the account's. Category
comes from history. Accounts come from the last import rule that matched.
*Test:* for every field, ask "what would a good guess be?" If a good guess exists, it is
the default and the field is optional.

### P3 — Show the consequence before the commit
Imports preview. Settlements narrate. Reconciliation shows the delta before applying it.
*Test:* can the user predict the resulting balances without doing arithmetic?

### P4 — Undo beats confirm
A confirm dialog interrupts everyone to protect against a rare mistake. Prefer soft deletes
(the schema already does this), status-bar toasts with undo, and reversible edits. Reserve
`ConfirmDialog` for genuinely destructive, non-reversible, or multi-record actions.
*Test:* if the action is reversible, it does not get a dialog.

### P5 — One idea per surface
A screen answers one question. When a surface starts answering two, that's a split, not a
tab.
*Test:* say the screen's question out loud in one sentence, no "and."

### P6 — Density is a feature, hierarchy is the constraint
A data app in a 13px system font: small and dense is correct. But density without hierarchy
is a spreadsheet. Within any dense view, exactly one element is loudest.
*Test:* squint. What do you see first? Is it the thing that matters?

### P7 — The case never excuses the work
See §2. The period chrome buys character; it buys no interaction debt.
*Test:* would this interaction be acceptable in a 2026 app if you restyled it flat? If no,
the costume is being used as an alibi.

### P8 — Silence on the path, celebration at the end
The entry path is quiet, fast and uninterrupted — no animation tax, no encouragement, no
mascot. Delight is concentrated at the boundaries where the chore actually ends: caught up,
reconciled, settled, import committed. Character that fires constantly stops being
character and becomes latency.
*Test:* is this flourish on the way to done, or at done? On the way, it's out.

---

## 4. Interaction laws

Concrete rules. Violating one requires a note in the epic file saying why.

**Keyboard.** Every flow on the entry path (add transaction, quick entry, import sort,
catch-up) is completable without the mouse. Tab order follows visual order. `Esc` closes
the topmost layer. `Enter` submits the primary action; `Cmd/Ctrl+Enter` submits from a
textarea. Anything that opens with a click and is used more than once a session gets a
shortcut, and shortcuts are discoverable in the UI, not just in this file.

**Focus.** Opening a modal or panel moves focus into it and traps it; closing returns focus
to the trigger. Focus rings are always visible: `outline: 2px solid var(--color-accent-mid)`.
Never `outline: none` without a replacement indicator.

**Latency.** Under 100ms: just do it. 100ms–1s: optimistic update, roll back and report on
failure. Over 1s: a `Shimmer` skeleton shaped like the incoming content — never a spinner
on a blank panel, never a layout that jumps when data lands.

**Notification.** Transient messages go to the status bar. Where an action is undoable, the
status-bar message carries the undo, and it names the keyboard shortcut alongside it
("Deleted bank:savings:czk. Undo ⌘Z") — the bar reports that undo exists, the keyboard is
what the user should reach for. When the bar gains an action it may pulse its background
once to catch the eye; it does not move, resize, or animate its height.

**Floating is for the invited.** Nothing floats over the work *uninvited* — a snackbar that
interrupts what you're reading is the thing that rule is aimed at. A surface that appears as
the direct consequence of the user's own click is invited and belongs over the content
rather than in the flow: a selection tray after checking a row, a picker under the field that
opened it. The test is whether the user would be surprised to see it. If they just caused it,
they wouldn't be.

**Errors.** Errors appear next to the thing that failed, in plain language, saying what to
do next. "Failed to save" is not an error message. Never a raw status code, never a
transient message for a field-level problem. If the user's work could be lost, it isn't —
keep the form state.

**Empty states.** Every list has a designed empty state naming the next action. Distinguish
three: first-run ("nothing here yet — here's how to start"), filtered-to-nothing ("no
matches — widen the filter"), and *cleared* ("nothing needs you"). The third is the win
condition and should read like one.

**Motion.** `var(--duration-fast) var(--ease)` for state changes; nothing over 200ms on the
entry path. Motion clarifies causality or it doesn't ship. Honour
`prefers-reduced-motion` — currently only two places do, which is a bug, not a standard.

**Celebration.** Reserved for completion boundaries. At most one per task; two bursts in a
row is a defect. Never on the entry path, never on a partial save. `CashConfetti` is the
existing instrument — new ones need a reason.

**Voice.** Dry, specific, competent. The app narrates what happened ("Settled $240.18
across 3 expenses"), it does not cheer. 有鱼 and the 🧧 are identity, not personality; the
app has no mascot and makes no jokes at the user's expense while they're doing taxes.

**Aggregates.** Every rollup carries the date it is complete through, computed from the same
rows it sums so the two can never disagree. Stale figures are not greyed out — when
everything is stale everything mutes and the page reads as broken; the date does the work and
the figure keeps its weight. A derived comparison (month over month, versus an average, any
trend) is **not drawn at all** unless both sides are fully covered, and its space says why:
a qualified comparison is still read as a fact, because the caveat is smaller than the number
and loses. Incomplete is a third state, never a low value — where a series is drawn, hatch it
with `--color-coverage-hatch`, the app's existing idiom for "not known".

Five rules under that heading, learned the hard way:

- **Two questions, two mechanisms.** "How current is this account" is answered by its leading
  edge. "Is this period recorded" is answered only by the spans themselves — an account covered
  Jan–Jun and Aug–Sep has a leading edge in September and says nothing about July. Never
  classify a period from an edge.
- **A floor is declared once and inherited.** When a period is marked as a floor rather than a
  value, every figure derived from that period is a floor too. Sub-totals and breakdown rows do
  not each restate it; the statement governing the period governs everything under it. Repeating
  the caveat per row is noise, and noise is how a caveat stops being read.
- **The caveat-loses rule has a scope.** A caveat loses to the number when it is *smaller than
  the thing it qualifies* — that is why a comparison is suppressed rather than annotated. When
  the whole line is the caveat, both facts belong in it: "complete through Apr 23, 1 account has
  no starting line" is strictly more than either half, and dropping the date to report the
  unknown throws away the most useful thing the app knows.
- **Unknown is not current.** An account that has never asserted coverage is not evidence of
  being up to date. It is reported alongside the date, never folded into the caught-up case,
  and it is named in the user's vocabulary — "no starting line", which names the fix — rather
  than in the app's.
- **With nothing known, say nothing.** A surface that describes coverage has nothing to describe
  when no coverage has ever been asserted. It makes no claim at all rather than reporting that
  everything is unrecorded, which is true and useless. Absence of the feature is not a finding
  about the user.

**Numbers.** All amounts render in `--font-mono` with aligned decimals so columns compare by
eye. Sign convention is in §5; colour reinforces the sign, the minus carries it.

**Layers.** Maximum one modal deep. A modal that needs to open another modal is a flow that
wants to be a full-screen wizard or a multi-step panel (see `AddAccountWizard`,
`ImportSortStep`). This law is currently violated; see §10.

---

## 5. The visual system

`frontend/src/styles/tokens.css` is the implementation; this section is the intent. Never
hard-code a colour, space, radius, or shadow — always a token.

### Aesthetic

The case draws from **2000s Mac OS X Graphite** — cool silver-grey shell, Lucida Grande as
the system font, Aqua-style gradient buttons and controls, soft drop shadows, dark section
bars, Graphite desktop. It should say "you are using a computer program."

The XP-era 3D bevel system has been removed. All controls use Aqua-style shadows. Anything
still reading as Windows rather than Mac is a leftover, not a choice — see §10.

### Visual rules

- **Radius scale** — `--radius-sm` (3px) badges/chips, `--radius-md` (6px) buttons/controls,
  `--radius-lg` (8px) cards/inner panels, `--radius-xl` (12px) modal windows,
  `--radius-pill` (999px) pill-shaped chips. Pills are a *work* idiom (currency pills,
  category chips); the case does not use them.
- **Aqua control shadows** — raised controls use `--shadow-control` (soft drop + top gloss).
  Pressed/inset surfaces use `--shadow-inset`. Cards use `--card-shadow` /
  `--card-shadow-hover`. Floating panels and dropdowns use `--shadow-window`.
- **All buttons are `GradientButton`** — gradient background with border. Hover = accent
  border colour. Active = `--shadow-inset`. `ChromeButton` is for case widgets only (modal
  close, titlebar controls). `Button` is deleted.
- **Cards are the surface primitive** — use `Card` for any grouped panel, with a
  `.section-header` div inside for titled sections (`--color-section-bar-*`). `Panel` is
  deleted.
- **Lucida Grande at small sizes** — 13–14px base. Small and dense is correct.
- **The desktop is Graphite** — `--color-desktop: #b8bcc2`, the whole page background.
- **Window chrome is cool silver-grey** — `--color-window: #f4f5f7`; content areas
  `--color-window-raised: #eceef2`; inset fields `--color-window-inset: #ffffff`.
- **The status bar is 30px** — it holds interactive text (the trust readout, and the undo
  action when that lands), so it clears WCAG 2.5.8's 24×24 minimum target. 30 rather than the
  24 + padding it looks like it needs: the bar clips its overflow, and a 24px target with a
  2px focus ring exactly fills 28, shearing the ring's top and bottom. Period-plausible —
  Aqua status bars ran ~22px, taller when they carried controls. The height is paid once and
  never animates (§2).
- **Title bars use the Graphite + Aqua gloss gradient** — multi-stop gloss over the Graphite
  hue; `--color-titlebar-border` + `--shadow-titlebar-inset` for the bottom border and top
  highlight. Title text uses `--font-serif`. Modals use `--shadow-modal`.

### Interaction finishes

- State changes transition on `var(--duration-fast) var(--ease)` — 80ms ease-in-out.
- Button press = `--shadow-inset` + `translate: 1px 1px`, not an instant jump.
- Every interactive element has a hover state. Nothing is ambiguous about clickability.

### Amount display

`--color-amount-positive` (green) for income, `--color-amount-negative` (red) for expenses.
Negative amounts in the data are expenses; positive are income. Always through
`MoneyDisplay`.

### Two rules that are load-bearing

**Tokens are a contract, not a palette.** `frontend/src/styles/tokens.test.ts` asserts
contrast invariants against the token file itself, because a fill and its trough only meet
each other in the compositor and no component test can catch that. When you add a token
pair that must stay distinguishable, add the assertion with it.

**Accent is user data.** Six accents (`frontend/src/lib/accent.ts`) times light/dark.
Anything you build must survive all twelve combinations. Never assume the accent is blue,
never assume the background is light. If it only looks right in one theme, it isn't
finished.

---

## 6. Components: reuse, extend, or replace

The inventory is `frontend/src/lib/components/ui/` (primitives) plus domain folders
(`accounts/`, `transactions/`, `import/`, `fish-pie/`, `catch-up/`, `spending/`,
`wizards/`). Read the primitives before building anything.

### The decision

1. **Does a primitive already do this?** Use it. `Card` is the surface, `GradientButton`
   the button, `Modal` the overlay, `TableShell` the data table.
2. **Does a primitive nearly do this?** Extend it with a prop *only if* the prop names a
   variant of the same idea (`Card gloss`, `Card muted`). If the prop is a mode switch — a
   boolean that changes what the component *is* — that's a second component.
3. **Is this the third time?** Two similar one-offs are fine. The third is a pattern:
   extract and migrate all three.
4. **Is the existing pattern actually good, or just present?** The question that never gets
   asked.

### The anti-accretion rule

**A component past ~400 lines or growing a third boolean mode prop is a design smell, not a
maintenance task.** It means a pattern was stretched past what it was for. The epic gets a
paragraph asking whether the flow itself is right before anyone refactors the file.

Watchlist, largest first: `fish-pie/GroupRightPanel` (1266),
`transactions/TransactionDetail` (1084), `accounts/CategoriesTab` (772),
`transactions/LedgerEditModal` (770), `fish-pie/GroupExpenseForm` (763),
`accounts/AccountPicker` (760), and the `/import` route at 1777 lines.

Being listed is not a defect. It's an invitation to ask P5's question of it.

### Retiring a pattern

Replacing something is normal here and should feel cheap. The Graphite epic deleted `Button`
and `Panel` outright; that is the template.

1. Build the replacement alongside the old thing.
2. Migrate every call site in the same epic — grep the import, fix all of them.
3. **Delete the old component in that epic.** Not later, not behind a flag.
4. Record the swap here if it changes a stated rule.

Two parallel ways to do the same thing is the failure mode this whole document exists to
prevent. With two users and no external contract, there is no reason to tolerate it.

---

## 7. How the UI evolves

The user base is two people. That is a design asset — it buys the freedom to ship bold
changes and learn from them, which a product with real users cannot do. Use it now, because
it expires.

### Every epic gets a UX brief

Before stories are written, the epic file in `planning/epics/` opens with:

```markdown
## UX brief
- **Question this screen answers:** (one sentence, no "and")
- **Inbox role:** (what outstanding work does this surface, or "none")
- **Primary action + interaction count:** (e.g. "record a transaction — 4 keystrokes")
- **Case or work:** (which side of §2 the new surfaces sit on)
- **Existing patterns reused:** (name them)
- **Patterns being stretched or replaced:** (name them, or "none")
- **What gets deleted:** (or "nothing", and why that's acceptable)
```

If "patterns being stretched" is non-empty and "what gets deleted" is empty, that epic is
adding to the pile and needs a reason.

### Quarterly-ish design pass

Roughly every ten shipped epics, run a pass and write it up in `planning/exploration/`. It
is a critique, not a refactor:

- Walk the primary flows (add a transaction, import a CSV, settle a Fish Pie, catch up a
  stale month) and count interactions. Compare to the last pass. Going up is a finding.
- List every surface a new user meets in their first ten minutes and grade it cold.
- Check the watchlist. Anything that grew is a candidate.
- Check §10. Anything still there after two passes is either being fixed now or being
  written into the philosophy as an accepted exception.
- Name one thing to delete. Every pass names one.

The output is exploration notes and usually one redesign epic — the pattern already in use
(`sidebar-redesign`, `spending-page-redesign`, `account-page-redesign`).

### Redesigns are epics, not side quests

A redesign gets a file, a UX brief, stories, and a PR like anything else. It ships behind no
flag and gets no compatibility shim. The old thing is deleted.

### Prototype in the browser, not in prose

For anything non-obvious, build it behind a route and look at it. A screenshot in the epic
beats three paragraphs describing a layout. Reviewing a real screen is the only reliable way
to know whether the density is right.

---

## 8. Building for people who aren't us

Today: two users on a Tailscale network. The stated future is friends and family, then
wider. These are expensive to retrofit and cheap to hold now.

**Nothing is learnable only by having been told.** Every non-obvious affordance carries a
tooltip, a placeholder, or an inline hint. The test: could the second user, who did not
build this, complete the flow without asking? Once there are ten users you will not be
around to answer.

**Accessibility is the floor, not a phase.** Semantic elements; `aria-label` or `.sr-only`
text on every icon-only control; a real label on every input; visible, managed focus; colour
never carrying meaning alone; 4.5:1 text and 3:1 graphics contrast in *both* themes. 48 of
~70 components use ARIA today — the gap is the backlog.

**Multi-tenancy is a UI concern too.** Fish Pie already makes this multi-user. Any new
surface should be legible when the data is shared: whose entry is this, who can edit it,
what does the other person see. Don't build a screen that only makes sense for a household
of one.

**Locale is not an afterthought.** Multi-currency is a core principle. Dates, numbers and
currency symbols route through `frontend/src/lib/currency.ts` and `date.ts` — never format
inline. Strings are English today; keep them in markup rather than concatenated in logic so
extraction stays possible.

**Web must survive small screens.** There's a React Native companion, but the web app gets
opened on a phone anyway. Nothing should be *unusable* below 768px. Prefer layouts that
reflow to layouts that need a breakpoint.

**Performance is UX.** Lists that can reach thousands of rows (transactions, import
previews) paginate or virtualise. Nothing on the entry path waits on a query that scans the
whole ledger.

### Cross-platform parity

`mobile/` is React Native and has no access to `tokens.css`. Web and mobile are expected to
differ in layout and interaction — a phone is not a desktop, and the case metaphor does not
travel. What may not differ is *vocabulary*: same concept, same name, same colour semantics,
same sign conventions. When a token's meaning changes on web, the mobile theme changes with
it in the same epic.

---

## 9. Review checklist

Run before opening a UI PR. Also the checklist for step 5 of the epic workflow in
`CLAUDE.md`.

- [ ] The primary action's interaction count is stated in the epic and hasn't gone up
- [ ] If this surface holds outstanding work, it reports its own count
- [ ] Every field that could have a sensible default has one
- [ ] Completable with the keyboard alone; focus visible, trapped in overlays, restored on close
- [ ] Loading, first-run, filtered-to-nothing and cleared states all designed
- [ ] New chrome is period, every widget in it does something real, and nothing in the case resizes
- [ ] Contextual controls float over the work rather than displacing it
- [ ] New flourishes fire at completion, not on the entry path
- [ ] Correct in light and dark, and in all six accents
- [ ] Contrast clears 4.5:1 (text) / 3:1 (graphics) in both themes; new token pairs asserted in `tokens.test.ts`
- [ ] No hard-coded colours, spacing, radii, or shadows — tokens only
- [ ] No new component duplicating a primitive; no third boolean mode prop
- [ ] Anything replaced is deleted in this PR, all call sites migrated
- [ ] Icon-only controls labelled; inputs have real labels; semantic elements used
- [ ] Nothing broken below 768px
- [ ] Destructive actions are reversible, or genuinely destructive and get a dialog
- [ ] Amounts use `MoneyDisplay`; sign legible without colour
- [ ] Every aggregate states what date it is complete through
- [ ] No comparison is drawn across a period that isn't fully covered, and no gap is priced
- [ ] Coverage is judged against every tracked account, not the ones that appear in the data
- [ ] Empty results say whether they are empty because nothing happened or because nothing is recorded

---

## 10. Where the app contradicts this document

Written 2026-09-03, from an audit of the code against the philosophy above. This is the
audit backlog — each item is a known contradiction, not a vague improvement. Strike them as
epics kill them.

### The case is not honest yet
- **The minimize button does nothing.** No handler at all in `+layout.svelte`. Delete it or
  give it a job. → `planning/epics/honest-chrome.md`
- **Close asks "Are you sure you want to quit?" and then calls `window.close()`**, which
  browsers ignore for tabs the script didn't open. The most prominent control in the app is
  a dead end. Sign out / lock is the honest meaning. → `planning/epics/honest-chrome.md`

### The case is not period yet
- **The tooltip is Windows XP.** `--color-tooltip-bg: #ffffe1` with a 1px black border is
  classic Win32, sitting inside a Mac OS X Graphite shell. Should be an Aqua tooltip.
  → `planning/epics/honest-chrome.md`
- **`-webkit-font-smoothing: none`** is an XP-era holdover fighting its own reference —
  Aqua was the era that introduced heavy anti-aliasing. It's why the type reads "Windows"
  even though everything around it reads "Mac". → `planning/epics/honest-chrome.md`

### The work is not modern enough
- **Modal nesting.** `TransactionDetailModal` is a `Modal` that renders `LedgerEditModal`,
  which is another `Modal` — two deep, in one of the busiest flows in the app. §4's
  one-deep law is already broken where it matters most.
- **The sidebar leads with nouns, not the loop.** Accounts first, Catch Up fifth. Under the
  inbox model the order is wrong.
- **No undo anywhere.** P4 prefers undo over confirm, but `toast` has no action affordance —
  it's a string and a timer, and none of the eleven soft-delete endpoints has a restore
  path. Undo needs to exist before "prefer undo" is a real rule.
  → `planning/epics/undo.md`
- **The toast timer is wrong.** `toast.show()` takes a `duration` argument and ignores it,
  hard-coding 3200ms. Small, but it's the notification surface. → `planning/epics/undo.md`
- **17 of 46 `toast.show()` call sites carry failures.** §4 says errors appear next to the
  thing that failed and persist; these evaporate in 3.2s in a bar nobody is watching.
  → `planning/epics/undo.md`

### Aggregates overstate what the app knows
- **Mobile (`mobile/`) has no coverage awareness at all.** The Companion shows balances and
  Fish Pie totals with none of the dating the web app now carries, so the same figure is honest
  on one surface and bare on the other. Same principle, different surfaces — its own epic.
- **The monthly spend series does not exist.** `/spending` fetches seven months of totals purely
  to compute two deltas and never draws them, so the hatch rule above is written for a chart
  nobody has built. If a trend is ever drawn there, the rule is already waiting for it.

### Standing debt
- **`prefers-reduced-motion`** honoured in 2 places out of ~30 that animate.
- **ARIA coverage** ~70% of components.
- **`/import` at 1777 lines** — redesigned once already. Next time split, don't grow.
- **No responsive audit** has ever been run on the web app.
- **No virtualisation** anywhere; transaction lists rely on date filtering to stay small.
- **Legacy accent aliases** (`--color-accent-mid`, `--color-accent-light`) still marked
  "components updated in story 4" in `tokens.css` — finish the migration or drop the label.
