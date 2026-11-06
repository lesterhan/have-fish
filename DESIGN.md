# DESIGN.md

The design of the rewrite: the desktop app in `core/` and `desktop/`. `CLAUDE.md` says how to
build; this says what to build and what it should feel like. It is being worked out, and it
grows only when something is built on it.

The current app's design is `frontend/DESIGN.md`. It is in maintenance and retires with that
app.

---

## Three priorities

High-level on purpose, and refined as the rewrite progresses. The system below serves them.

### Speed and reliability

Complex workflows are quick, easy and dependable. The yardstick is importing a large monthly
statement: it should feel short, and nothing in it should make you wonder whether it worked.

### Clarity

Financial screens are crowded with numbers and accounts. Whoever is looking finds the number
that matters to them quickly, and everything else steps back.

### Delight

have-fish has personality: the spirit of the weird JavaScript websites and small video games
its owner grew up making. It is not a bank app's careful neutrality.

## Show, don't tell

The app shows how it works through what is on the screen rather than sentences about it: a
keycap beside the action it starts, a part that shows the word it wants, an example in the format
to type, the options you can pick, state you can see. On a screen full of numbers every word is a
cost. Every screen is reviewed with one question: what here is a sentence explaining something the
screen could show?

## The system

What the screens are built from. They move onto it one at a time; a screen that hasn't yet stays
plain, with every visual value from `tokens.css`. Nothing is ported from the current app's look.

### Type

Four faces, each by its job: the sans for the interface, the serif for titles, the figures mono
for amounts and dates, the code mono for account paths and a bank's own text.

| Step | Regular | For |
|---|---|---|
| `--text-key` | 11px | Keycaps, tags, pills |
| `--text-small` | 12px | Day bands, where a transaction came from, a refusal's reason |
| `--text-quiet` | 13px | The From column, options in a picker, the sidebar |
| `--text-base` | 14px | Rows, fields, buttons |
| `--text-sentence` | 15px | The details card's sentence, the palette's input |
| `--text-title` | 20px | A place's title |

- Weights are 400, 500 for labels and a path's last part, 600 for titles and totals.
- Every amount, date, count and total is in the figures mono with `tabular-nums`, right-aligned in
  its column, so a column of amounts lines up on the decimal point.
- A size in a component is a type token, never a number.

### Money and days

- **An amount** is grouped by thousands with a comma, with as many decimals as its currency has
  (`1,234.50`, `¥1,500` as `1,500`), and a true minus (−).
- **The home currency goes unsaid** in lists and totals; any other says its code after the amount,
  small and quiet (`35.00 EUR`). A transaction's details always say the code.
- **A row's sign reads without colour**: a spend has none, money in has `+` and the money-in
  colour, a transfer has ⇄ before it.
- **A day** reads `Thu 5 Nov`, with the year when it isn't this one (`Thu 5 Nov 2025`). A day band
  puts `Today ·` or `Yesterday ·` before it. A moment reads `Thu 5 Nov 2026, 12:40`.

### Space and density

- Space steps by 4px: `--space-1` 4px to `--space-8` 32px. A place's content sits 16px in, 12px
  below the narrow width.
- **Density is a setting**, in the View menu and the palette beside zoom. It sets the row height
  and the base type size, and the other type steps move with the base; the layout keeps its
  shape. Zoom scales everything.

| Density | Row | Base type |
|---|---|---|
| Compact | 30px | 13px |
| Regular (default) | 33px | 14px |
| Comfortable | 40px | 14px |
| Large | 46px | 16px |

### Layout

- **The sidebar** is 176px on the deepest rung and holds places only, each with its keycap.
- **A place** is a header (its title, one quiet line, at most one primary button), a notice under
  the header when something was refused, and its list at full width. Nothing persistent sits
  beside the list. Reports is the one place with two lists side by side: the tree, and the spends
  of what's selected in it.
- **Details open in place**, under their row. Pickers open under their field, and the palette
  opens near the top of the window over a scrim.
- **The ledger's columns** read left to right as what happened: From (196px), Amount (92px), To,
  Description. Day bands carry their date and the day's net.
- **One narrow width, 44rem.** Below it the places go across the top as a strip, the ledger drops
  its From column (the details still show it), and content sits 12px in. A half-screen window at
  200% lands here, and the 360px minimum is a layout, not a clipping.

### Surfaces

A surface sits on the same rung of the lightness ladder in every theme (Themes, below). OKLCH
lightness, light / dark:

| Rung | Light | Dark | What sits on it |
|---|---|---|---|
| Sidebar | 0.90 | 0.15 | The places |
| Background | 0.99 | 0.215 | The work: rows, the card, the composer, pickers, the palette |
| Band | 0.948 | 0.262 | Day bands, the card's foot, chips, a filled part of the composer |
| Selected | 0.918 | 0.30 | The selected row, the active option |
| Rule | 0.895 | 0.312 | The line under each row |

- **Floating layers are opaque where you read from them** (the card, pickers, the date list, the
  palette's panel, tooltips) and lift with a shadow from `tokens.css`.
- **Glass is where things pass under**: a band header rows scroll beneath is frosted, and the
  palette's scrim blurs and dims the ledger. The contract checks ink on glass against the darkest
  surface that can show through it. `prefers-reduced-transparency` makes it opaque.
- **Stepping back:** while the composer is open the rest of the ledger is at 42%, and while a card
  is open the rest of the list is at 50%. What steps back isn't for reading; reaching for it
  closes what's open.

### Parts

Every screen is built from parts, and each part is built once. The design is known before the
screens are rebuilt, so a part that several screens will use is built as a part by the first
screen that needs it, not copied until a third copy forces it out.

1. **A part lives in `desktop/renderer/parts/`**, one per file. Its rules are in a `.ts` module
   beside it, tested without a DOM, as `picker.ts` and `selection.ts` already are.
2. **A place's style is layout only**: grid, widths, gaps, order. Colour, type, borders, radius,
   shadow and motion belong to parts and to `tokens.css`.
3. **Use, extend, or replace.** Use a part that does the job. Extend it with a prop only when the
   prop names a variant of the same thing; a boolean that changes what it is makes a second part.
   A part past about 250 lines, or growing a third mode, is asking to be two.
4. **Replacing means deleting.** The change that brings a part moves every caller onto it and
   deletes what it replaces. There are never two ways to do one thing.
5. **What a part owns can't be hand-rolled elsewhere**, and a guard says so: a listbox's role and
   `aria-activedescendant` only in `Listbox`, a `<kbd>` only in `Keys`, money and days only
   through `Money` and `Day`, a media query's width only the narrow one, a size only a type token.
6. **Every part shows on one sheet** in each of its states, light and dark, which the capture
   script shoots, so a change to a part is seen everywhere it lands. The sheet is built for tests
   only and never packaged.

| Part | States | Used by |
|---|---|---|
| `Keys` | A keycap, or several | Buttons, places, rows, the composer, the palette |
| `Button` | Rest, hover, focus, pressed, disabled; primary, plain or quiet | Everywhere; one primary per place at most |
| `Money`, `Day` | An amount with its code when it isn't the home currency, a sign that reads without colour; a short date with the year quiet | Everywhere |
| `Path` | The root's initial in a square tinted by kind of account, standing in for its word (`l cibc:visa`); colons kept and quiet; the last part at 500. A picker's trail spells the root out | Rows, chips, pickers, the trail, Accounts, Reports |
| `Listbox` | Windowed, keyboard, active option; empty | The ledger, Accounts, Reports, pickers, the palette |
| `Row` | Rest; hover a lighter step; selected in a focused list (tint, accent edge, its keys); selected elsewhere (plain tint); being rewritten (●); just written (wash) | Every list |
| `Band` | A day or a group, with its net; frosted while rows pass under | The ledger, the batch, Accounts, Reports |
| `Card` | Attached to its row and lifted with it: inset 8px, radius 9px, the lift shadow; a foot band for where it came from and the actions | The ledger, Reports' spends |
| `Chip` | Rest, hover, focus, changing (it becomes its own editor), just saved (an accent flash, a tick), locked | The card's sentence |
| `PathPicker` | Opens on focus at the current level; letters in order anywhere in the path; last used first; a trail you can click at every level; Create last | The composer, chips, Refile, Accounts |
| `Popover` | Opaque, fades in 4px down | Pickers, the date list, tooltips |
| `Notice` | Under a place's header, where you were looking; an action and ✕; stays until acted on | Every place |
| `Empty` | Shows what to do rather than saying it: an example, a drop target, the composer open | Every list, the palette |

**Focus** is always a 2px accent ring outside the control. Every control has a hover state.

### Writing and changing

- **The composer** opens with + New or Ctrl+N as a line in the ledger, lifted: an accent ring, a
  New pill, Done with its Esc key. Its parts are in the order you think of them: From, Date,
  Amount, Description, To. Each shows its word until filled; the next is underlined, dotted, with
  its Tab key; a refused part is underlined red with two words of why. The first time, the words
  are examples in the format to type.
- **It writes a batch.** Enter saves the line, which drops into the batch under the composer, and
  a fresh line keeps From and the date. A line dated in the past carries its date as a chip. Esc
  closes it, and each row goes to its day, lit where it lands.
- **Details** open with Enter as a sentence of chips, each chip where you change that part, and
  **a change from a chip saves at once**: undo takes it back. Where it came from and the actions
  sit at the foot; P shows the postings with a balance check per currency.
- **Refile** is R on a selected row: the path picker, for To.
- **Ctrl+K** lists every action in `desktop/shared/actions.ts`, under headings, with its keys.

### Motion

Quick, and horizontal or a short drop. Changing place is instant. Nothing moves more than 40px,
and nothing moves under a number you are reading. A wash changes colour, never position.

| What happens | How it moves | Time |
|---|---|---|
| Details open | Unfold from their row | 160ms |
| A picker opens | Fades in 4px down | 120ms |
| The palette opens | Fades in from 98% | 160ms |
| A line is saved in the batch | Drops 38px into it; the fresh line fades in | 420ms, 250ms |
| The batch closes | Each row lit where it lands | 2.4s |
| A line is written | Slides in 32px from the left, then a wash | 220ms, 900ms |
| A chip is saved | An accent flash, then a tick | 1.4s |
| An import row is confirmed | 40px right, faded by halfway, then folds | 500ms |

With `prefers-reduced-motion`, nothing moves: what would have is there at once, and a wash is a
one-second tint.

### Where delight lives

Feedback, flair and quick motion, and words most of all. Never sound: a sound you didn't expect
startles.

- **The techy side stays**: account paths with their colons, keycaps on everything, the postings
  as text.
- **A transaction says what happened**: the row reads From, Amount, To, and the card is a sentence.
- **It shows in the moments you finish something**: a line dropping into the batch, rows landing
  on their day, a chip's flash, the card's offset shadow in the accent, a statement's "All
  sorted".
- **It stays out of the way of the numbers**: nothing animates on scroll, on a change of place, or
  over an amount you are reading.

## It is a desktop app

The current app was a website dressed as a program. This one is a program, so it behaves like
the other windows on the machine before it has any look of its own.

- **The case is the OS's.** The window uses the frame the operating system draws: its
  titlebar, its controls, its resizing and tiling. The app draws no chrome of its own, and its
  menu bar is the OS's application menu. Personality goes into the work and the themes, never
  into a costume frame.
- **Every action is in the menu, with its shortcut.** One list of actions
  (`desktop/shared/actions.ts`) feeds the menu, the hints beside buttons and the palette (Ctrl+K), so a
  shortcut is never in one place and missing from another. A packaged build has no Reload and no
  developer tools.
- **Places down the left**: Ledger, Accounts, Reports, each with its shortcut, Ctrl+1 and on,
  in the order they're listed. A place stays open while another shows,
  so going somewhere else loses nothing half-typed. Below the narrow width they go across the
  top.
- **Picking is typing.** A field that takes one of a list (From) filters it by the letters typed,
  in order, without regard to case. Down lists them all, the arrows move, Enter picks without
  sending the form, and Escape puts back what was there. Left empty, it means its default. Where
  a new one can be made (To), a name I haven't used is the last option, "Create …", and is
  made when the form is saved. Each option says what kind of thing it is when the list mixes
  kinds, as To mixes categories and my accounts.
- **Any width the window allows works.** Half a screen beside a bank statement is a normal way
  to use it, and the minimum size is a layout, not a clipping.
- **Zoom is the person's.** Ctrl+= and Ctrl+− work everywhere, and nothing breaks at 200% or at
  fractional scaling.
- **Nothing is fetched.** Fonts, icons and themes ship inside the app, and it opens with the
  network off. The window shows once the page is ready, on the theme's background colour, so a
  launch never flashes white.
- **It reopens where it was left**: the window's size and place, and in time the screen and
  anything half-typed.
- **The OS's furniture where it has some.** Native file and message dialogs (they order their
  buttons the platform's way), a file dropped on the window, and the clipboard both ways: a
  table copies as tab-separated text, so it pastes into a spreadsheet.
- **The person's settings win.** `prefers-reduced-motion`, `prefers-contrast` and
  `forced-colors` override any theme.
- **Linux first.** It is packaged for Linux first. macOS follows its platform through
  `CmdOrCtrl` and native dialogs, not through a second design.

## Undo

Undo takes back the last change to the ledger, whatever it was, so nothing needs an "are you
sure?". These rules hold for every kind of change, now and later; `desktop/main/undo/steps.test.ts`
and `desktop/e2e/undo.e2e.ts` hold the ones a test can.

1. **One step is one thing you did.** Writing a spend, saving an edit, removing one, Ctrl+S across
   three drafts, an import, a category set on forty rows: each is one step, and undo never takes
   back half of one.
2. **Undo moves forward, never back.** It writes the earlier versions again as new versions: a
   tombstone for something new, the earlier version for an edit, the live one for a removal.
   Nothing is erased, so history and sync see just another change.
3. **Undo never overwrites anything newer.** If any document in the step has changed since, from
   another device or anything else, the undo is refused whole and says why, and the step leaves
   the history. Versions are compared, never bodies.
4. **One history per session, newest first.** Undo goes back in order, and a new change clears
   redo. Quitting clears the history; going further back is the ledger's history of versions.
5. **The menu names the step:** "Undo remove Coffee", "Undo save 3 spends", and is greyed out
   with nothing to undo. Every kind of step has its words in `desktop/copy/steps.ts`.
6. **Redo** is Ctrl+Shift+Z, and Ctrl+Y on Windows and Linux, under the same rules.
7. **You see what came back.** After an undo or redo, the list selects what changed. If it
   changed in another place, that place shows.
8. **Typing comes first.** Ctrl+Z undoes a field's typing only if you've typed in that field since
   you entered it; otherwise it undoes the ledger. A draft isn't a step; saving it is.
9. **Only changes to the ledger are steps.** Selecting, scrolling, exporting, zoom and settings
   aren't, and don't clear the history.
10. **Taking back something older is a command, not an undo.** Undoing an import from its list, or
    restoring an earlier version, is a new step, which Ctrl+Z can take back in turn. Changes
    from another device never go on the history.

## Themes

The desktop app can have themes, colours to start with.

- **A theme changes the colours, never the hierarchy.** An element sits on the same rung of the
  lightness ladder in every theme, as the current app's ladder already requires of light and
  dark (`frontend/DESIGN.md` §5). That app's first dark theme kept every colour of the palette it
  borrowed and lost every relationship, which is the failure this rule is for.
- **Colours are tested, not reviewed.** One tokens file declares every colour. A contract of
  plain functions checks ink (4.5:1 for text, 3:1 for graphics) and surfaces (each step at least
  ΔL 0.04, and within 2x across schemes), and a guard fails a colour declared anywhere else
  (`desktop/shared/theme/contract.ts`, held to by `desktop/renderer/tokens.test.ts`).
  Every built-in theme passes them in a test, and a theme you make will pass them as you make it.
- **Money is not themed, and neither are the kinds of account.** The colours for money in and
  out, for an error, and for each root (assets, liabilities, expenses, income) stay fixed in
  every theme, and none of them carries a meaning alone: a sign reads without colour, and a root
  shows its initial.
- **A theme belongs to the machine, not the ledger.** It lives in the app's settings, never in
  the ledger file.
- **A theme is a few inputs, not a stylesheet**: light or dark, a neutral hue and chroma, an
  accent hue. The app places them on the ladder and derives every colour (`deriveTokens`), and
  `tokens.css` holds the built-ins' colours as `bun run themes` writes them, never by hand. There
  are no public CSS variables the way Obsidian has them.
- **Built-ins first, your own later.** The app ships a few built-in themes, each stored as those
  inputs. Making your own is a picker over the same inputs, and it comes later.
- **The built-ins are Graphite light and Graphite dark**, and following the system picks between
  them. Both have a warm neutral (hue 75, chroma 0.012) and a lively accent (chroma 0.17): ochre
  (hue 90) in light, persimmon (hue 38) in dark.

## What the current app taught

Nothing in the current app's design binds the rewrite. A rule is adopted by naming it and
writing it here, short, with a test where it can have one, as Parts does with that app's rule
for reusing components. What is worth adopting, and what stays behind:

| Worth adopting | Stays behind |
|---|---|
| Tokens as a contract, held by tests | The 2003 case and its costume controls |
| An accent as a hue on fixed rungs | Lucida Grande, which Linux doesn't have |
| Money and status as two vocabularies | A theme made by swapping a palette |
| One `Sheet` geometry, day bands over rows | Layouts sized only for a wide window |
| The keyboard, focus and latency laws (§4) | Toasts that vanish in a bar nobody watches |
| One part per job; replacing means deleting | A design document too long to read |

That last one is why this document stays short and why its rules live in tests wherever they
can.
