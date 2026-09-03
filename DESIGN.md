# DESIGN.md

The design constitution for have-fish. `CLAUDE.md` says how to build; this says what to
build and why it should feel the way it does.

**Read this before starting any epic that touches the UI**, before adding a component to
`frontend/src/lib/components/`, and before deciding that an existing pattern is "close
enough." Implementation details (token names, the component `<script>` shape) stay in
`CLAUDE.md` and `frontend/src/styles/tokens.css` — this file does not repeat them.

---

## 1. The thesis

Personal finance tracking is a chore. Nobody opens this app for fun; they open it because
a week of transactions has piled up and the number in the corner is no longer trustworthy.

**The product's job is to make the chore end sooner.** Every design decision is measured
against the time between "I should update my finances" and "my finances are updated and I
believe the numbers."

Three consequences that are not negotiable:

**Entry speed is the primary metric.** Keystrokes and decisions per transaction are the
thing to optimize. A feature that adds a field to the common path had better remove two
somewhere else. When in doubt, count the interactions — literally, in the epic file.

**Double-entry is an implementation detail, not a UI.** The ledger underneath is real and
correct (it exports to hledger — see the Vision in `CLAUDE.md`). The user should never be
asked to think in debits and credits to record lunch. The mechanics stay available for
anyone who wants them and invisible for everyone who doesn't. "Expose the ledger, don't
impose it."

**Trust is earned by being checkable.** This is a numbers app. Every displayed figure must
be traceable to the rows that produced it in at most two clicks. Never round silently,
never hide a reconciliation gap, never show a total whose provenance the UI can't explain.
A pretty dashboard nobody believes is worse than an ugly table they do.

---

## 2. Principles

Each principle has a test. If you can't apply the test, the principle isn't doing work.

### P1 — The common path is the fast path
The 80% action on any screen is reachable without a modal, a menu, or a scroll.
*Test:* name the single most frequent action on the screen. Count the interactions to
complete it from a cold page load. If it's more than three, the screen is wrong.

### P2 — Never ask for what you can infer
Dates default to today or the last-used date. Currency defaults to the account's. Category
comes from history. Accounts come from the last import rule that matched.
*Test:* for every field on a form, ask "what would a good guess be?" If a good guess
exists, it is the default and the field is optional.

### P3 — Show the consequence before the commit
Imports preview. Settlements narrate. Reconciliation shows the delta before applying it.
Money-moving actions state their effect in plain language before the button does anything.
*Test:* can the user predict the resulting balances without doing arithmetic?

### P4 — Undo beats confirm
A confirm dialog interrupts everyone to protect against a rare mistake. Prefer soft
deletes (the schema already does this), toasts with undo, and reversible edits. Reserve
`ConfirmDialog` for genuinely destructive, non-reversible, or multi-record actions.
*Test:* if the action is reversible, it does not get a dialog.

### P5 — One idea per surface
A screen answers one question. `/accounts` answers "what do I have"; `/spending` answers
"where did it go"; `/catch-up` answers "what haven't I recorded." When a surface starts
answering two questions, that's a split, not a tab.
*Test:* say the screen's question out loud in one sentence, no "and."

### P6 — Density is a feature, hierarchy is the constraint
This is a data app in a 13px system font. Small and dense is correct. But density without
hierarchy is a spreadsheet: within any dense view, exactly one element is loudest and the
eye lands there first.
*Test:* squint at the screen. What do you see first? Is it the thing that matters?

### P7 — The desktop metaphor is a costume, not a cage
The Graphite/Aqua shell is deliberate and it stays. It buys "you are using a program, not
a website." What it does not buy is 2003 interaction design: no nested modals, no
five-field dialogs, no OK/Cancel where inline editing works. Modern interaction wearing
period chrome.
*Test:* would this interaction be acceptable in a 2026 app if you restyled it flat? If no,
the chrome is being used as an excuse.

---

## 3. Interaction laws

Concrete rules. Violating one requires a note in the epic file saying why.

**Keyboard.** Every flow on the entry path (add transaction, quick entry, import sort,
catch-up) is completable without the mouse. Tab order follows visual order. `Esc` closes
the topmost layer. `Enter` submits the primary action; `Cmd/Ctrl+Enter` submits from a
textarea. Anything that opens with a click and is used more than once a session gets a
shortcut, and shortcuts are discoverable in the UI, not just in this file.

**Focus.** Opening a modal or panel moves focus into it and traps it; closing returns
focus to the trigger. Focus rings are always visible — `outline: 2px solid
var(--color-accent-mid)`. Never `outline: none` without a replacement indicator.

**Latency.** Under 100ms: do it, no feedback needed. 100ms–1s: optimistic update, roll
back and toast on failure. Over 1s: `Shimmer` skeleton that matches the shape of the
incoming content — never a spinner on a blank panel, never a layout that jumps when data
lands. Reserve space for content you know is coming.

**Errors.** Errors appear next to the thing that failed, in plain language, saying what to
do next. "Failed to save" is not an error message. Never a raw status code, never a toast
for a field-level problem. If the user's work could be lost, it isn't — keep the form state.

**Empty states.** Every list has a designed empty state that names the next action. "No
transactions" is a dead end; "No transactions yet — import a CSV or add one" is a doorway.
A first-run empty state and a filtered-to-nothing empty state are different states and say
different things.

**Motion.** `var(--duration-fast) var(--ease)` for state changes; nothing longer than
200ms on the entry path. Motion clarifies causality (this panel came from that button) or
it doesn't ship. Honour `prefers-reduced-motion` — currently only two places do, which is
a bug, not a standard.

**Numbers.** All amounts render in `--font-mono` with aligned decimals so columns compare
by eye. Sign convention is in `CLAUDE.md` (negative = expense) and rendered through
`MoneyDisplay`; colour alone never carries the sign — the minus or the parenthesis does
the work, colour reinforces it.

**Layers.** Maximum one modal deep. A modal that needs to open another modal is a flow
that wants to be a full-screen wizard or a multi-step panel (see `AddAccountWizard`,
`ImportSortStep`). This rule has been bent; it should stop being bent.

---

## 4. The visual system

`frontend/src/styles/tokens.css` is the implementation; this section is the intent. Never
hard-code a colour, space, radius, or shadow — always a token.

### Aesthetic

The UI draws from **2000s Mac OS X Graphite** — cool silver-grey shell, Lucida Grande as
the system font, Aqua-style gradient buttons and controls, soft drop shadows, dark section
bars, Graphite desktop.

The goal is to feel like a real desktop application, not a website. It should say "you are
using a computer program."

The XP-era 3D bevel system has been removed. All controls use Aqua-style shadows.

### Visual rules

- **Radius scale** — `--radius-sm` (3px) badges/chips, `--radius-md` (6px) buttons/controls,
  `--radius-lg` (8px) cards/inner panels, `--radius-xl` (12px) modal windows,
  `--radius-pill` (999px) pill-shaped chips.
- **Aqua control shadows** — raised controls use `--shadow-control` (soft drop + top gloss
  highlight). Pressed/inset surfaces use `--shadow-inset` (recessed trough). Card surfaces
  use `--card-shadow` / `--card-shadow-hover`. Floating panels and dropdowns use
  `--shadow-window`.
- **All buttons are `GradientButton`** — gradient background with border. Hover = accent
  border colour. Active = `--shadow-inset`. `ChromeButton` is for window-chrome widgets
  only (modal close button, titlebar controls). `Button` is deleted.
- **Cards are the surface primitive** — use `Card` for any grouped panel. Add a
  `.section-header` div inside for titled sections (uses `--color-section-bar-*` tokens).
  `Panel` is deleted.
- **Lucida Grande at small sizes** — the system font is `Lucida Grande, Segoe UI`. Text is
  small (13–14px base).
- **No font smoothing** — `base.css` sets `-webkit-font-smoothing: none` for crisp pixel
  rendering.
- **The desktop is Graphite** — `--color-desktop: #b8bcc2`, the entire page background.
- **Window chrome is cool silver-grey** — `--color-window: #f4f5f7`. Content areas are
  `--color-window-raised: #eceef2`. Inset fields (inputs, list boxes) are
  `--color-window-inset: #ffffff`.
- **Title bars use the Graphite + Aqua gloss gradient** — multi-stop gloss overlay on the
  Graphite hue; `--color-titlebar-border` + `--shadow-titlebar-inset` for the bottom border
  and top highlight. Title text uses `--font-serif`. Modal windows use `--shadow-modal`.

### Interaction finishes

- All state changes (hover, active, focus) transition on
  `var(--duration-fast) var(--ease)` — 80ms ease-in-out.
- Button press = `--shadow-inset` + `translate: 1px 1px`, not an instant jump.
- Focus rings are visible and intentional: `outline: 2px solid var(--color-accent-mid)`.
- Every interactive element has a hover state. Nothing is ambiguous about clickability.

### Amount display

`--color-amount-positive` (green) for income, `--color-amount-negative` (red) for expenses.
Negative amounts in the data are expenses; positive are income. Rendered through
`MoneyDisplay`; colour reinforces the sign, the minus carries it.

### Two rules that are load-bearing

**Tokens are a contract, not a palette.** `frontend/src/styles/tokens.test.ts` asserts
contrast invariants against the token file itself, because a fill and its trough only meet
each other in the compositor and no component test can catch that. When you add a token
pair that must stay distinguishable, add the assertion with it.

**Accent is user data.** Six accents ship (`frontend/src/lib/accent.ts`) plus light/dark.
Anything you build must survive all twelve combinations. Never assume the accent is blue,
never assume the background is light. If a component only looks right in one theme, it is
not finished.

## 5. Components: reuse, extend, or replace

The inventory is `frontend/src/lib/components/ui/` (primitives) plus domain folders
(`accounts/`, `transactions/`, `import/`, `fish-pie/`, `catch-up/`, `spending/`,
`wizards/`). Read the primitives before building anything — most needs are already met.

### The decision

Before writing a new component, answer in order:

1. **Does a primitive already do this?** Use it. `Card` is the surface primitive,
   `GradientButton` is the button, `Modal` is the overlay, `TableShell` is the data table.
2. **Does a primitive nearly do this?** Extend it with a prop *only if* the prop names a
   variant of the same idea (`Card gloss`, `Card muted`). If the prop is really a mode
   switch — a boolean that changes what the component *is* — that's a second component.
3. **Is this the third time?** Two similar one-offs are fine. The third is a pattern:
   extract it into a primitive and migrate all three.
4. **Is the existing pattern actually good, or just present?** This is the question that
   never gets asked. See below.

### The anti-accretion rule

**A component that has crossed ~400 lines or grown a third boolean mode prop is a design
smell, not a maintenance task.** It means a pattern was stretched past what it was for.
When you hit one, the epic gets a paragraph asking whether the flow itself is right before
anyone refactors the file.

Current watchlist, largest first — these are candidates for redesign, not just cleanup:
`fish-pie/GroupRightPanel` (1266), `transactions/TransactionDetail` (1084),
`accounts/CategoriesTab` (772), `transactions/LedgerEditModal` (770),
`fish-pie/GroupExpenseForm` (763), `accounts/AccountPicker` (760), and the
`/import` route itself at 1777 lines.

Being on this list is not a defect. It's an invitation to ask P5's question of it.

### Retiring a pattern

Replacing something is normal here and should feel cheap. The Graphite epic deleted
`Button` and `Panel` outright; that is the template.

1. Build the replacement alongside the old thing.
2. Migrate every call site in the same epic — grep for the import, fix all of them.
3. **Delete the old component in that epic.** Not later, not behind a flag.
4. Record the swap in `CLAUDE.md`'s Design System section if it changes a stated rule
   (as `Button` and `Panel` are recorded as deleted today).

Two parallel ways to do the same thing is the failure mode this whole document exists to
prevent. With two users and no external contract, there is no reason to tolerate it.

---

## 6. How the UI evolves

The user base is two people. That is a design asset — it buys the freedom to ship bold
changes and learn from them, which a product with real users cannot do. Use it now,
because it expires.

### Every epic gets a UX brief

Before stories are written, the epic file in `planning/epics/` opens with:

```markdown
## UX brief
- **Question this screen answers:** (one sentence, no "and")
- **Primary action + interaction count:** (e.g. "record a transaction — 4 keystrokes")
- **Existing patterns reused:** (name them)
- **Patterns being stretched or replaced:** (name them, or "none")
- **What gets deleted:** (or "nothing", and why that's acceptable)
```

Five lines. If "patterns being stretched" is non-empty and "what gets deleted" is empty,
that epic is adding to the pile and needs a reason.

### Quarterly-ish design pass

Roughly every ten shipped epics, run a pass and write it up in
`planning/exploration/`. It is not a refactor; it is a critique:

- Walk the primary flows (add a transaction, import a CSV, settle a Fish Pie, catch up a
  stale month) and count interactions. Compare to the last pass. Going up is a finding.
- List every surface a new user would meet in their first ten minutes and grade it cold.
- Check the watchlist above. Anything that grew is a candidate.
- Name one thing to delete. Every pass names one.

The output is exploration notes and, usually, one redesign epic — the pattern already in
use (`sidebar-redesign`, `spending-page-redesign`, `account-page-redesign`).

### Redesigns are epics, not side quests

A redesign gets a file, a UX brief, stories, and a PR like anything else. It ships behind
no flag and gets no compatibility shim. The old thing is deleted.

### Prototype in the browser, not in prose

For anything non-obvious, build the thing behind a route and look at it. A screenshot in
the epic beats three paragraphs describing a layout. Reviewing a real screen is the only
reliable way to know if the density is right.

---

## 7. Building for people who aren't us

Today: two users on a Tailscale network. The stated future is friends and family, then
wider. These are the things that are expensive to retrofit and cheap to hold now.

**Nothing is learnable only by having been told.** Every non-obvious affordance carries a
tooltip, a placeholder, or an inline hint. The test: could the second user, who did not
build this, complete the flow without asking? Once there are ten users you will not be
around to answer.

**Accessibility is the floor, not a phase.** Semantic elements (`<button>`, `<table>`,
`<label>`); every icon-only control gets `aria-label` or `.sr-only` text; every input gets
a real label; focus is visible and managed; colour never carries meaning alone; text
contrast clears 4.5:1 and UI graphics clear 3:1 in *both* themes. 48 of ~70 components
use ARIA today — the gap is the backlog.

**Multi-tenancy is a UI concern too.** Fish Pie already makes the app multi-user. Any new
surface should be legible when the data is shared: whose entry is this, who can edit it,
what does the other person see. Don't build a screen that only makes sense for a household
of one.

**Locale is not an afterthought.** Multi-currency is a core principle. Dates, number
formats, and currency symbols route through `frontend/src/lib/currency.ts` and
`date.ts` — never format inline. Strings are English today; keep them in markup rather
than concatenated in logic so extraction stays possible.

**Web must survive small screens.** There's a React Native companion for phones, but the
web app gets opened on a phone anyway. Nothing should be *unusable* below 768px, even
where it isn't optimised. Prefer layouts that reflow to layouts that need a breakpoint.

**Performance is UX.** Lists that can reach thousands of rows (transactions, import
previews) paginate or virtualise. Nothing on the entry path waits on a query that scans
the whole ledger.

### Cross-platform parity

`mobile/` is React Native and has no access to `tokens.css`. Web and mobile are allowed —
expected — to differ in layout and interaction; a phone is not a desktop. What may not
differ is *vocabulary*: the same concept has the same name, the same colour semantics, and
the same sign conventions on both. When a token's meaning changes on web, the mobile theme
changes with it in the same epic.

---

## 8. Review checklist

Run before opening a UI PR. Also the checklist for step 5 of the epic workflow in
`CLAUDE.md`.

- [ ] The primary action's interaction count is stated in the epic and hasn't gone up
- [ ] Every field that could have a sensible default has one
- [ ] Completable with the keyboard alone; focus visible, trapped in overlays, restored on close
- [ ] Loading, empty, error, and "filtered to nothing" states all designed — not just the happy path
- [ ] Correct in light and dark, and in all six accents
- [ ] Contrast clears 4.5:1 (text) / 3:1 (graphics) in both themes; new token pairs asserted in `tokens.test.ts`
- [ ] No hard-coded colours, spacing, radii, or shadows — tokens only
- [ ] No new component that duplicates an existing primitive; no third boolean mode prop
- [ ] Anything replaced is deleted in this PR, all call sites migrated
- [ ] Icon-only controls labelled; inputs have real labels; semantic elements used
- [ ] Nothing broken below 768px
- [ ] Destructive actions are reversible, or they're genuinely destructive and get a dialog
- [ ] Amounts use `MoneyDisplay`; sign is legible without colour

---

## 9. Known debt

Live list. Add to it when you find something; strike it when an epic kills it.

- **Modal nesting.** The one-modal-deep law is violated in the Fish Pie and ledger edit
  flows. Needs a wizard/panel pattern to replace it.
- **`prefers-reduced-motion`** is honoured in 2 places out of ~30 that animate.
- **ARIA coverage** is ~70% of components.
- **`/import` at 1777 lines** is the largest single surface in the app and has been
  redesigned once already. Next time it should be split, not grown.
- **No responsive audit** has ever been run on the web app.
- **No virtualisation** anywhere; transaction lists rely on date filtering to stay small.
- **Legacy accent aliases** (`--color-accent-mid`, `--color-accent-light`) are still in
  `tokens.css` marked "components updated in story 4" — either finish the migration or
  drop the "legacy" label.
