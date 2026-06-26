# Epic: Account Path Input Redesign — "Drill + Type"

Goal: Replace the single-text-box `AccountPathInput` with a structured **breadcrumb-drill +
global-search** control (design "Model D"), built around a **segment-aware ranking scorer**.
The current control treats a hierarchical account path as freeform text — the root of three
friction points the design calls out (ranking pollution, stranded cursor, wrong mental model).
The worst-hit surface is **CSV import**, where the control is touched 30+ times in a row.

## Design handoff

High-fidelity design produced externally. Assets live in `.design/` (gitignored — not pushed):

- `.design/account-path-input-redesign.zip` → `design_handoff_account_path_input/`:
  - `README.md` — the spec. Four models A–D; **Model D ("Drill + type") is the one we ship.**
  - `pg/scorer.js` — the segment-aware ranking algorithm + weights. **Port faithfully** — this
    is the core IP; the whole control's "feel" depends on it. Pure, framework-agnostic.
  - `pg/accounts.js` — `ACCOUNTS` is mock data (ignore); the **tree helpers** `childrenOf` /
    `nodeAt` are reusable logic to port.
  - `pg/picker.js` — interaction reference (Model D is `mountHybrid()`). Port *behavior*
    (keyboard map, mode transitions, focus rules), not the imperative DOM code.
  - `AccountPathInput Playground.html` — interactive prototype. Try `expenses:hou`, `foodburger`.

## Strategy — strangler fig

We do **not** retrofit the scorer into the old box. We build a **new** component
(`AccountPicker`, Model D + scorer) standalone, then migrate the 19 call sites to it one
cluster at a time — validating look + interaction at each — until nothing imports the old
`AccountPathInput`, then delete it. Import rows go **first** (the primary painpoint and Model
D's reason for existing).

## Decisions / deviations from the spec

- **Tokens: remap, don't import.** The handoff ships its own Aqua palette (copper `#c0651f`,
  JetBrains Mono, light+dark). Our app is single-theme Graphite + Lucida Grande. Map design
  *intent* onto our `frontend/src/styles/tokens.css` (`--color-accent-*`, `--font-mono`,
  `--radius-*`, our shadow tokens). **No hardcoded hexes** (CLAUDE.md). Account paths stay
  monospace via our `--font-mono`.
- **No dark theme.** Drop the design's `.theme-dark` variant; we have one theme.
- **Frequency: skipped for now.** The scorer takes a `freq` per account for a gentle tie-break
  and the drill columns sort by subtree frequency. We have `fetchAccountPostingCounts()`
  available but are **not wiring it yet** — pass `freq = 0` everywhere. Ranking stays fully
  segment-aware; tie-breaks fall through to **alphabetical**. (`childrenOf` must sort by freq
  desc **then path asc** so all-zero freq degrades to a stable alpha order.) Frequency
  weighting is a clean follow-up once this ships.
- **Both contract modes preserved.** The old control has two shapes the new one must cover:
  - default — `value` is an account **ID**, supports inline **create** (`oncreate`,
    `allowCreate`), reverts on blur if no exact match.
  - `searchOnly` — `value` is a **path string** filter, no create, partial paths valid
    (used in `FilterPanel`).
  Plus `oncommit` fires after any selection. `AccountPicker` keeps this same prop surface so
  migration is a drop-in per call site.
- **Density.** Import rows / posting-editor rows are currently 22px / 11px-mono cells. Model
  D's breadcrumb box (chips + ⌕ button) is taller. The user wants Model D *in the import rows*
  specifically, so those rows grow to fit — accepted, not a blocker. Watch row rhythm during
  the import-row migration.
- **Safety floor (all from the spec, non-negotiable):**
  - **Demoted create** — "Create new `<query>`" sits below a dashed divider, is **never** the
    default `Enter` target; `Enter` always accepts the top *real* match. Fixes the current
    box's accidental-account-creation-on-Enter risk during batch import.
  - **No stranded cursor** — the resting state is breadcrumb chips, not a pre-filled text box,
    so there's nothing to clear.

## Model D behavior (the target)

- **Resting:** breadcrumb chips of the committed path (`expenses › food › groceries`) in a
  field box with a ⌕ button pinned right.
- **Click a chip** → dropdown column of that level's siblings (sorted by subtree freq → alpha).
  Re-pick exactly the segment you meant.
- **Start typing** (any printable key while focused) → chips morph into a text input, dropdown
  becomes **global fuzzy search** over all paths, ranked by the scorer with matched-char
  highlight spans.
- **⌕ button** = a doorway, not a mode toggle: same as starting to type with an empty query.
- The rule, one sentence: *click when it's close, type when it's not.*
- Keyboard (drill): letters→search; ↑/↓ move column; → drill into highlighted; ←/Backspace up
  a level; Enter commits (and drills if it has children); Esc closes.
- Keyboard (search): ↑/↓ through ranked results; Enter accepts top real match; Esc snaps back
  to the committed breadcrumb; Backspace on empty query exits search → drill.
- Active row kept in view by manual offset math — **not** `scrollIntoView`.

## Stories

1. **Scorer + tree helpers (pure modules + tests).** Port `scorer.js` → `accountScorer.ts`
   (`rank`, `scoreOne`, weights verbatim) and the tree helpers → `accountTree.ts`
   (`buildTree`, `childrenOf`, `nodeAt`; freq-desc-then-path-asc sort). Comprehensive unit
   tests using the spec's **verified rankings** as cases (`expenses:hou` → housing before
   home; `rent` exact-leaf jackpot; `foodburger`; `recvhouse`; `coffee`). No UI yet.

2. **`AccountPicker` component (Model D), standalone.** Build the breadcrumb-drill + search
   control on our tokens, with the full keyboard map, demoted-create, both contract modes
   (ID + create / `searchOnly` path), portal dropdown + drop-up positioning. Not yet wired into
   any call site. Visual parity pass against the playground (remapped to Graphite).

3. **Migrate import rows.** Swap `AccountPathInput` → `AccountPicker` in `ImportRowRegular`
   (and `ImportRowTransfer` if it uses it), `ImportPreviewPanel`, `EditParserPanel`. Validate
   the touch-30×-in-a-row flow, row height/rhythm, create-on-import, keyboard-only entry.

4. **Migrate remaining call sites cluster by cluster.** Transactions
   (`TransactionDetail`, `AddTransactionModal`, `PostingEditorRow`, `LedgerEditModal`,
   `FilterPanel` searchOnly), fish-pie (`CategoryManager`, `GroupRightPanel`,
   `GroupExpenseForm`, `GroupSettleBatchModal`), wizards (`AddParserWizard`), settings/quick
   entry, and the route pages. Each cluster: swap, eyeball look + interaction, ship.

5. **Deprecate + delete `AccountPathInput`.** Confirm zero imports remain, remove the old
   component and its dead helpers, final regression pass.
