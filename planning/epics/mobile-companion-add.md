# Epic: Pocket Companion — Add Screen / Speed Entry (Companion 2 of 4)

**Goal:** Rebuild the Add tab as the design's single-job speed-entry screen: a
mono amount hero, a **custom numpad** (no OS keyboard for amount), inline
currency/date/payer/category controls, and a one-tap Add with a green success flash
— **tuned to fit a 412×892 screen without scrolling**. Wire it to the existing
`createExpense`, supplying the payment account silently from the payer's default.

Builds on Epic 1 (theme, fonts, gloss primitives, shell, bottom-sheet).

## Design reference

- **Screenshot:** `.design/add-expenses-tab.png`
- **Handoff:** `.design/handoff/README.md` — sections *Screen: Add (home / speed
  entry)*, *Components → Custom Numpad / Chip*, *State*, *Interactions & behavior*.
- **Prototype:** `.design/handoff/companion/screen-add.jsx`, `companion/ui.jsx`
  (Numpad, PayerSeg, Chip), `companion/data.jsx` (currencies, symbols).

## Layout (locked, top→bottom)

Single vertical column, `padding: 10 16 12`, `gap: 9` between blocks. Fits without
scrolling on 412×892. Order:

1. **Amount hero card** — `surface`, soft-gloss, radius 16, padding `11 16`.
2. **Description** — Label + single-line input (the **only** OS-keyboard field).
3. **Paid by** — Label + two equal segments.
4. **Category** — Label + horizontal-scroll chip rail.
5. **Numpad** — 3×4 grid.
6. **Add Expense** — full-width accent gloss button, height 50.

## Backend reconciliation (decisions locked)

- **Payment account = silent payer default.** `createExpense` requires
  `paymentAccountId`, but the design has no such field. Use the payer member's
  `defaultPaymentAccountId` (from `group.members[].defaultPaymentAccountId`).
  - If the selected payer has **no** default payment account, the form cannot
    submit. Surface a clear, one-time inline guard ("Set a default payment account
    for {payer} on the web app") rather than a generic error, and keep the Add
    button disabled. Do **not** add a picker — keep the numpad flow clean.
  - The payer toggle changes which member's default account is used; recompute on
    payer change.
- **Category → posting account** is resolved server-side from `myMapping`; mobile
  only passes `categoryId`. No "your share posts to…" hint in this design (that was
  the old form) — categories are read-only here, managed on web.
- Currencies: there is **no per-group quick-currency concept in the backend.** Use a
  static/local quick list **CAD · CZK · CNY · EUR** (handoff default); the full list
  (`+ USD · GBP · JPY`) lives in the Currency sheet. Symbols: CAD/USD `$`, EUR `€`,
  GBP `£`, JPY/CNY `¥`, CZK `Kč`.
- Offline: `createExpense` already enqueues on network failure (`lib/api.ts`).
  Preserve that — a failed submit while offline should read as "queued", not a hard
  error.

---

## Stories

### Story 1 — Amount hero card + custom numpad

**Hero card (from handoff):**
- Top row (space-between, center, `margin-bottom 4`):
  - Left cluster (`gap 9`): `AMOUNT` Label + a **date chip** — borderless button:
    12px calendar glyph + `dateLabel` ("Today"/"Yesterday"/ISO) + small `▾`, mono
    11/600 `ink2`. (Opens Date sheet — Story 3.)
  - Right: **currency pill** — accent gloss, radius 8, padding `5 11`, mono 12/700,
    ls 0.8, white text + `text-shadow 0 1px 1px rgba(0,0,0,.2)`, shows `{ccy} ▾`.
    (Opens Currency sheet — Story 2.)
- **Amount display:** mono **40/700**, ls −1.5, right-aligned, tabular-nums,
  `min-height 44`. `ink` when > 0, else `ink3`. Integer part gets thousands
  separators; decimals shown exactly as typed (`12.` shows `12.`). Empty → `0.00`
  in `ink3`.

**Numpad (from handoff "Custom Numpad"):** 3×4 grid, `gap 7`. Keys `1–9`, then
`.`, `0`, `⌫`. Each key height **46**, neutral soft-gloss on `surface` (radius 11),
mono digits 22/600, `⌫` 19. Press feedback `translateY(1px)` + `brightness(0.97)`
via `onPressIn/onPressOut` on `Pressable`.

**Input model (`amount` is a string):**
- digit: append; if `.` present and 2 decimals already typed, ignore; replace a lone
  leading `0`; cap length ~10.
- `.`: add once; if empty becomes `0.`.
- `⌫`: drop last char.

Keep `amount` formatting (separators on the integer part) as a display transform —
store the raw typed string.

**Tests:** input-model unit coverage (leading-zero replace, single dot, 2-decimal
cap, length cap, backspace to empty → `0.00`); display formatting (thousands
separators, trailing-dot passthrough); haptic on submit only (not per key).

### Story 2 — Currency pill + quick chips + Currency sheet

- **Quick-currency chips** (`margin-top 10`, wrap, `gap 7`): mono chips for
  CAD · CZK · CNY · EUR + a `···` chip that opens the Currency sheet. Active chip =
  active-chip style (Epic 1 `Chip`). Tapping sets currency inline.
- **Currency pill** and `···` chip both open the **Currency sheet** (Epic 1
  bottom-sheet primitive): a 3-column grid of `{code}` + `{symbol}` tiles covering
  the full list (CAD/CZK/CNY/EUR/USD/GBP/JPY). Selecting sets currency + closes.
- Currency persists across submits (you log several in a row) and is remembered per
  group (reuse the existing `havefish_last_currency_{groupId}` key, default
  `group.defaultCurrency`).

**Tests:** selecting a quick chip and a sheet tile both update the pill + amount
color logic; persistence across submit; sheet covers the full currency list.

### Story 3 — Date chip + Date sheet

- Date chip opens the **Date sheet**: Today / Yesterday / Pick-a-date. Pick uses the
  native date input (`@react-native-community/datetimepicker`, already a dep) with
  `max = today`. `dateLabel` reflects the choice.
- State: `dateMode: 'today' | 'yesterday' | 'pick'` + `pickDate` ISO. Resolve to the
  ISO `date` passed to `createExpense`. Date **persists** across submits.

**Tests:** each mode resolves to the correct ISO; future dates blocked; label
matches selection.

### Story 4 — Paid by segments + Category rail

- **Paid by:** Label + two equal segments (`gap 8`). Each (`flex 1`, `gap 10`,
  padding `9 12`, radius 11): 30px `Avatar` (initials, mono) + name (system-ui
  14/700) + `{pct}% share` (mono 10.5 `ink3`, nowrap). Selected = accent soft-gloss
  fill + `1.5px accentLine` border, name `accentInk`, avatar → accent gloss + white
  initials. Unselected = `field` bg + `1.5px line` border. Single-select.
  - `{pct}` comes from member `shareWeight` normalized to a percentage across the
    group. **2-member assumption:** render exactly two segments; if the group has 1
    member, render one (full width); if 3+, fall back to a wrapping/scrolling row
    rather than crashing (rare on mobile, but must not break).
- **Category rail:** Label + horizontal-scroll chip rail (one line, no wrap, hidden
  scrollbar). Chips padding `7 13`, 13px; selected = active-chip style. The rail
  **bleeds to screen edges** (`margin: 0 -16; padding: 0 16 2`) so chips scroll under
  the edge — this is the answer to "what about 8 categories". Categories are
  **read-only** here (managed on web); source = active `group.categories` sorted by
  `sortOrder`, excluding `archivedAt`. Tapping the selected chip clears it
  (uncategorized), matching current behavior.

**Tests:** payer toggle is single-select and recomputes the payment account; share %
renders from `shareWeight`; category rail lists active categories in order; tap-to-
clear works; 1-member and 3-member groups don't crash.

### Story 5 — Submit, success flash, persistence

- **Add Expense button:** full-width accent `GlossButton`, height 50. Disabled when
  amount = 0 **or** the payer has no default payment account (muted fill, `ink3`,
  no shadow).
- **Submit:** validate amount parses > 0; empty description allowed → falls back to
  "Untitled" (handoff) — reconcile with the current "Expense" fallback; pick one and
  note it. Call `createExpense(group.id, { description, amount: toFixed(2),
  currency, date, paidByUserId, paymentAccountId: payerDefault, categoryId })`.
- **Success state:** on success the button becomes green (`#3f7d5a`) showing
  `✓ Added` for ~1.3s, then resets. **Clear amount + description; persist
  currency / payer / category / date** (you're usually logging several). Fire one
  light haptic (`expo-haptics`, already a dep). Trigger a balances/history refresh
  for the other tabs (shared state).
- Offline failure → "queued" affordance (the request is enqueued by `lib/api.ts`),
  not a red error.

**Tests:** disabled-state logic (amount 0, missing payment account); successful
submit clears the right fields and keeps the sticky ones; success flash timing/reset;
"Untitled" fallback; offline → queued path surfaces correctly.

---

## Out of scope

- Editing/deleting expenses (History tab — Epic 4 / future).
- Per-group configurable quick currencies (static list for now).
- Multi-payer / arbitrary split editing (single payer, group-configured weights).

## Notes

- The whole screen is **no-scroll on 412×892** — verify on a real/standard device;
  if it overflows, the numpad key height (46) and block gaps (9) are the tuning
  knobs, per the handoff.
- Amount stays a **string** end-to-end (`numeric(12,2)` convention); never parse to
  float except the final `toFixed(2)` for the API body.
</content>
