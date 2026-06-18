# Epic: Pocket Companion — Shell, Theme & Navigation (Companion 1 of 4)

**Goal:** Re-found the mobile app's visual identity and navigation around the
[Pocket Companion design](../../.design/handoff/README.md): the warm/rust Aqua
palette, bundled Source Serif 4 + JetBrains Mono fonts, the layered-gradient gloss
recipe, and the new shell — **app opens straight into the primary group's Add
screen**, with a 3-tab bottom bar (Add / Balances / History), a persistent header
(group switcher + settings gear), and bottom-sheet primitives.

This is the foundation epic. Epics 2–4 (Add, Balances+Settlement, History+Settings)
all build on the tokens, primitives, and shell delivered here. Nothing here changes
the data layer — `lib/api.ts` is untouched.

## Design reference

- **Screenshots:** `.design/add-expenses-tab.png`, `.design/balances-tab.png`,
  `.design/history-tab.png`, `.design/settings-page.png`
- **Handoff (authoritative spec):** `.design/handoff/README.md` — see sections
  *Information architecture*, *Device & frame*, *Components* (Header, Tab bar,
  Bottom sheet), *Gloss recipe*, *Design tokens*, *Typography*.
- **Prototype source:** `.design/handoff/companion/theme.jsx` (token + gloss math),
  `companion/ui.jsx` (Avatar, Label, Chip, GlossBtn, TabBar, Header, Sheet),
  `companion/app.jsx` (routing/state). These are **web-React references — do not
  ship them**; recreate in the Expo/RN codebase.

**Locked variant:** `gloss: "Subtle"` (level 1), `corners: "Default"`, **light
theme**. Ignore the prototype's Tweaks panel (Flat/Full/Round/Sharp/dark are
exploration only). Dark tokens are included in the handoff for later parity — not
this epic.

## Backend / current-state reconciliation

- Current nav: `app/(app)/index.tsx` (Groups list) → `groups/[id].tsx` (group
  detail with a 4-tab `SegmentedTabs`). This epic **inverts** that: the group is the
  shell, not a pushed detail screen. The Groups *list* becomes a bottom sheet, not a
  launch wall.
- "Primary group" = the last-visited group id (persist via AsyncStorage, key
  `havefish_last_group`), falling back to the first group from `fetchGroups()`. If
  the user has **no** groups, show a minimal create/empty state in the shell.
- Settings moves off the tab bar to a header gear action (a pushed screen or a
  full-height sheet — implementer's choice, but it is *not* a bottom tab).
- The current `SegmentedTabs`, `ScreenHeader`, `Button`, `Chip` components are
  restyled or replaced; keep them compiling for screens not yet migrated, or migrate
  call sites as part of the relevant story.

---

## Stories

### Story 1 — Warm/rust theme tokens

Rewrite `lib/theme.ts` from the Graphite/Aqua-blue palette to the Companion light
palette. This is a single-point swap; downstream screens read `theme.*`.

**Tokens (light — locked; from handoff "Design tokens"):**

```
// Surfaces
appBg    #e7e3da   // page background behind cards
chrome   #efece6   // header + tab bar
surface  #fcfbf8   // cards
surface2 #f3f0ea   // recessed / tags
field    #ffffff   // inputs
line     #dbd5ca   // borders
lineSoft #e8e4db   // dividers

// Text
ink      #2a2620   // primary
ink2     #746d61   // secondary / labels-on-fill
ink3     #a89f90   // faint / placeholders

// Accent (rust)
accent     #c0651f
accentSoft #f5e6db  // selected chip/segment fill   (accent + white 84%)
accentLine #e3ba9a  // selected border              (accent + white 55%)
accentInk  #b45f1d  // text on accentSoft fills      (accent darkened 6%)
accentGlossTop #c8793c · accentGlossBorder #a1551a  (see gloss recipe)

// Status
green   #3f7d5a   greenBg rgba(63,125,90,.12)
red     #b3492a   redBg   rgba(179,73,42,.10)
```

- **Radii scale (Default):** `4 · 8 · 9 · 11 · 12 · 14 · 16`. Map to named tokens
  (e.g. `radius.chip:9`, `radius.field:11`, `radius.btn:12`, `radius.cardSm:14`,
  `radius.card:16`, `radius.sheet:18`). Note this is a **departure from the web's
  sharp-corner rule** — the Companion design intentionally uses soft radii.
- **Spacing:** screen pad `16`, block gap `9–13`, chip gap `7`. Reconcile with the
  existing `sp` scale; add the in-between values the design needs (7, 9, 10, 11, 13)
  rather than rounding to the 4px grid, since the layout is tuned to fit a 412×892
  screen without scrolling.
- Keep the token object shape (`theme.color`, `theme.sp`, `theme.text`,
  `theme.radius`, …) so call sites change values, not structure. Update the
  `bun run lint:tokens` guardrail expectations if any literal must live in
  `theme.ts` (e.g. precomputed gloss hexes — see Story 3).
- Update `theme.ts`'s doc header to describe the Companion palette and that the
  source of truth is `.design/handoff/README.md`.

**Tests / checks:** `bun run lint:tokens` passes (no stray literals outside
`theme.ts`); a snapshot/visual pass on one migrated screen.

### Story 2 — Bundle fonts (Source Serif 4 + JetBrains Mono)

Match the web (`frontend/src/styles/base.css`) plus the design's numpad weight.

- Add `expo-font`. Bundle font files under `mobile/assets/fonts/`:
  - **Source Serif 4** — weight **600** (headers, sheet titles). Web loads 600+700;
    600 is the only weight the design actually uses (group name 23/600, sheet titles
    19/600). Bundle 700 only if a use appears.
  - **JetBrains Mono** — weights **400, 500, 600, 700**. Web bundles 400/500/700;
    the design adds **600** for numpad digits (22/600) and dates (11/600). All
    numerals, labels, currency codes, balances, tags use mono.
- Load via `useFonts` (or `expo-font` plugin for prebuild) and gate the app render
  on `fontsLoaded` with the existing splash/loading pattern. Wire family names into
  `theme.font` (`serif`, `mono`, `sans = undefined → system`).
- `system-ui` (Roboto on Android) stays the body/sans font for descriptions, member
  names, button labels, settings rows, sentences — do **not** bundle a sans face.
- Confirm the font assets are picked up by the CI release build
  (`.github/workflows/build-android.yml` / prebuild) — fonts must survive
  `assembleRelease`, not just Expo Go.

**Tests / checks:** app renders mono numerals + serif header on device/emulator;
APK build still succeeds with fonts bundled; note the APK size delta in the PR.

### Story 3 — Gloss primitives (`expo-linear-gradient`)

Add `expo-linear-gradient` and build the two gloss flavors from the handoff "Gloss
recipe" (locked = Subtle/level 1). Because RN can't do `color-mix`, **precompute the
lighten/darken hexes** in `theme.ts`.

**Accent gloss** (primary buttons, currency pill, selected avatar):
```
background:  linear-gradient(180deg, #c8793c, #c0651f)
border:      1px solid #a1551a
shadow:      0 2px 6px rgba(0,0,0,.16)   → elevation ~4
inset top:   1px rgba(255,255,255,.32)   → 1px top highlight View / hairline
radius:      12 ; color #fff ; text-shadow 0 1px 1px rgba(0,0,0,.18)
```
**Neutral soft-gloss** (cards, numpad keys, gear, sheets, active chips) on base `c`:
```
sheen:   linear-gradient(180deg, rgba(255,255,255,.28), rgba(255,255,255,0) 60%)
base:    linear-gradient(180deg, lighten(c,2%), darken(c,5%))
border:  1px solid darken(c,10%)
shadow:  0 1px 2px rgba(0,0,0,.10)       → elevation ~2
inset top: 1px rgba(255,255,255,.7)
```

**RN mapping (from handoff):**
- Each CSS gradient → an `<LinearGradient>`. Neutral gloss = **two stacked
  gradients**: base gradient as container background, white sheen as an
  absolutely-positioned overlay (top→transparent).
- Drop shadow → iOS `shadowColor/Opacity/Radius/Offset` + Android `elevation`
  (~2 cards/keys, ~4 buttons, ~12 sheets).
- `inset 0 1px 0 rgba(255,255,255,X)` top highlight → a 1px-tall `View` pinned to
  the top edge, or a hairline top border.
- `text-shadow` → RN `textShadow*` props.

**Deliver as reusable primitives:**
- `GlossSurface` — neutral soft-gloss container (takes base color + radius). Used by
  cards, sheets, numpad keys, gear.
- `GlossButton` — accent gloss button (also a neutral variant for "All groups").
  Supports disabled (muted fill, `ink3` text, no shadow) and the green success state
  (`#3f7d5a`) used by Add (Epic 2).
- `Avatar` — circle from member initials; default neutral, accent-gloss + white
  initials when selected. Sizes 28/30/32 used across screens.
- Restyle `Chip` to the design: inactive `field` bg + `1.5px line` border, radius 9,
  `ink2`; active = neutral soft-gloss on `accentSoft` + `1.5px accentLine` border,
  `accentInk`, weight 700.
- `Label` — the recurring uppercase mono caption (10.5/700, ls 1.3, `ink2`).

**Tests / checks:** a small "kitchen-sink" preview (dev-only screen or Storybook-ish
scratch) showing each primitive; press feedback works (gloss buttons/keys
`translateY(1px)` + dim on `onPressIn/Out`).

### Story 4 — Shell: header, bottom tabs, group sheet

Replace the Groups-list-as-home + stack-detail nav with the Companion shell.

- **Entry:** app opens on **Add** for the primary group (last-visited or first).
  Rework `app/(app)/_layout.tsx` + `index.tsx` so there is no Groups-list launch
  wall. Expo Router: a tab navigator (Add/Balances/History) under the authenticated
  group context, with the active group id in shared state/context.
- **Header (persistent, from handoff "Header"):** `chrome` bg, `1px line` bottom
  border, padding `12 16 11`. Left: group name in **Source Serif 23/600** (ls −0.3)
  with a `▾`, and a `{n} members · {ccy}` sub-line (mono 10.5, `ink3`); tapping opens
  the **Groups sheet**. Right: 36px gear `GlossSurface` button → Settings (Epic 4
  fills the screen; here it can route to a placeholder).
- **Tab bar (from handoff "Tab bar"):** `chrome` bg, `1px line` top border. 3 items,
  each a stroked 22px icon (`@expo/vector-icons`) over an 11px label; active =
  `accent`, inactive = `ink3`. Icons: Add = plus, Balances = scale/balance,
  History = list. Respect bottom safe-area inset (gesture nav 24px).
- **Bottom-sheet primitive (from handoff "Bottom sheet"):** scrim
  `rgba(0,0,0,.32)`; panel `surface`, top radius 18, `1px line` top border,
  `shadow 0 -10px 30px rgba(0,0,0,.25)`, 40×4 grab handle (`line`), title (Source
  Serif 19/600) + ✕. Slide-up over scrim, no decorative animation. Reused by Groups
  (this epic) and Currency/Date (Epic 2).
- **Groups sheet:** lists the user's groups; selecting one switches the active group,
  persists it as last-visited, and returns to Add. Creating a group can stay minimal
  here (reuse existing create flow) — full Settings/all-groups polish is Epic 4.
- **Empty/edge states:** 0 groups → create prompt; the design assumes a 2-member
  couple, but the shell must not crash for 1-member or 3+ groups (header sub-line and
  later screens degrade gracefully).

**Tests / checks:** launching lands on Add for the persisted group; tab switching
works; group sheet switches + persists; back-from-Settings returns to the shell;
safe-area insets respected on a gesture-nav device.

---

## Out of scope (this epic)

- The Add numpad/form internals (Epic 2), Balances/Settlement (Epic 3),
  History/Settings content (Epic 4) — this epic delivers shells/placeholders for
  Balances/History/Settings, not their final content.
- Dark theme, per-user accent fetch, Full/Flat gloss variants.
- Any backend change.

## Notes

- Keep `bun run lint:tokens` green throughout — precomputed gloss hexes live in
  `theme.ts` only.
- Where the handoff gives a web CSS value, the README's "React Native mapping" notes
  are the conversion contract — follow them rather than improvising.
</content>
</invoke>
