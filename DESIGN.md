# DESIGN.md

The design of the rewrite: the desktop app in `core/` and `desktop/`. `CLAUDE.md` says how to
build; this says what to build and what it should feel like. It is being worked out, and it
grows only when something is built on it.

The current app's design is `frontend/DESIGN.md`. It is in maintenance and retires with that
app.

---

## Three priorities

The rewrite has no UI system or template yet; one is being worked on. What it has is three
priorities, high-level on purpose and refined as the rewrite progresses, and the rules below for
being a desktop app and for themes.

### Speed and reliability

Complex workflows are quick, easy and dependable. The yardstick is importing a large monthly
statement: it should feel short, and nothing in it should make you wonder whether it worked.

### Clarity

Financial screens are crowded with numbers and accounts. Whoever is looking finds the number
that matters to them quickly, and everything else steps back.

### Delight

have-fish has personality: the spirit of the weird JavaScript websites and small video games
its owner grew up making. It is not a bank app's careful neutrality.

## Until the system lands

- **Rewrite screens stay plain.** Semantic HTML, the system font, and every visual value from
  one tokens file, so the system can be dropped in when it exists. Claude does not invent an
  aesthetic in the meantime, and nothing is ported from the current app's look.
- **Plain is not slow or muddy.** Speed and clarity don't wait for a palette: a plain screen
  still has a short path and an obvious number.
- **Nothing in the current app's design binds the rewrite.** That is `frontend/DESIGN.md`. A
  story may adopt one of its principles by naming it, as the undo story does with P4 ("undo
  beats confirm"). Adopting one is a choice the story makes, not a default, and the principle
  comes here, rewritten short, with a test where it can have one.

## It is a desktop app

The current app was a website dressed as a program. This one is a program, so it behaves like
the other windows on the machine before it has any look of its own.

- **The case is the OS's.** The window uses the frame the operating system draws: its
  titlebar, its controls, its resizing and tiling. The app draws no chrome of its own, and its
  menu bar is the OS's application menu. Personality goes into the work and the themes, never
  into a costume frame.
- **Every action is in the menu, with its shortcut.** One list of actions
  (`desktop/shared/actions.ts`) feeds the menu, the hints beside buttons and, later, a command
  palette, so a shortcut is never in one place and missing from another. A packaged build has no
  Reload and no developer tools.
- **Places down the left.** Each place is a list beside a pane (Spends, Accounts), with its
  shortcut, Ctrl+1 and on, in the order they're listed. A place stays open while another shows,
  so going somewhere else loses nothing half-typed. Below the narrow width they go across the
  top.
- **Picking is typing.** A field that takes one of a list (From) filters it by the letters typed,
  in order, without regard to case. Down lists them all, the arrows move, Enter picks without
  sending the form, and Escape puts back what was there. Left empty, it means its default.
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
  (`desktop/renderer/theme/contract.ts`, held to by `desktop/renderer/tokens.test.ts`).
  Every built-in theme passes them in a test, and a theme you make will pass them as you make it.
- **Money is not themed.** The colours for money in and out stay fixed, and a sign reads
  without colour.
- **A theme belongs to the machine, not the ledger.** It lives in the app's settings, never in
  the ledger file.
- **A theme is a few inputs, not a stylesheet**: light or dark, a neutral hue and chroma, an
  accent hue. The app places them on the ladder and derives every colour. There are no public CSS
  variables the way Obsidian has them.
- **Built-ins first, your own later.** The app ships a few built-in themes, each stored as those
  inputs. Making your own is a picker over the same inputs, and it comes later.

## What the current app taught

Worth adopting, each by the first story that needs it, as the rule above says, and what
stays behind:

| Worth adopting | Stays behind |
|---|---|
| Tokens as a contract, held by tests | The 2003 case and its costume controls |
| An accent as a hue on fixed rungs | Lucida Grande, which Linux doesn't have |
| Money and status as two vocabularies | A theme made by swapping a palette |
| One `Sheet` geometry, day bands over rows | Layouts sized only for a wide window |
| The keyboard, focus and latency laws (§4) | Toasts that vanish in a bar nobody watches |
| The third copy of a rule becomes shared | A design document too long to read |

That last one is why this document stays short and why its rules live in tests wherever they
can.
