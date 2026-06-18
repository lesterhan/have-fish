# Epic: have-fish Pocket Companion — Mobile Design Foundation

**Goal:** Give the mobile app (`mobile/`) a real, shared visual identity —
**"have-fish Pocket Companion"** — and the token foundation to scale as we fill out
features. Today every screen hardcodes its own hex (`#2563eb` ×27, `#e0e0e0`,
`#1a1a1a`, …) in scattered `StyleSheet.create` blocks; there is no theme, no single
source of truth, and the look is generic iOS-blue Material — divorced from the web's
Graphite/Aqua design system.

This is the deferred **story 7** of [Mobile Revival](archive/mobile-revival.md), now
its own epic.

**Status:** Done — shipped 2026-06-18 (stories 1–5, PRs #59, #60, #61, #62, #64;
plus #63 hiding the invite UI on full two-member groups). Mobile now reads from a
single `lib/theme.ts`, shares Chip/Button/ScreenHeader/SegmentedTabs primitives,
and a `bun run lint:tokens` guardrail blocks raw color literals outside the token
file. Light-only; dark variant, per-user accent, and a bundled font remain
deferred as noted in "Out of scope".

---

## Design decisions (2026-06-18)

Settled with Lester before scoping:

1. **Anchor = the fish-pie group page.** The group detail screen
   (`app/(app)/groups/[id].tsx`) — header + back, 4-tab underline bar, flat bordered
   content cards — is the reference layout. Its card-based, flat-surface look guides
   every other screen for now.
2. **Aqua-card subset, not full XP bevels.** React Native has no native CSS
   `box-shadow`/`linear-gradient` parity, and 4-layer bevel borders are fiddly and
   poor for touch. We adopt the **web `--card-*` surface model**: Graphite color
   palette + accent, flat bordered cards, hairline rules, subtle elevation, near-sharp
   corners. We deliberately skip `--shadow-raised`/`--shadow-sunken` XP bevels on
   mobile. (Bevels can be revisited later if it ever feels too flat.)
3. **Light first, structured for dark.** Tokens are defined as a palette that *can*
   carry a dark variant (mirror web's Nord dark), but only the light theme is wired and
   tested this epic. Dark is a later flip, not new structure.
4. **System font for now.** Lucida Grande doesn't exist on Android; web falls back to
   Segoe UI → Android falls back to Roboto. Use the system font, zero APK weight. The
   font is a *named token* so swapping in a bundled face later is a one-line change.
5. **Fixed default accent.** Hardcode the web default Aqua accent (`#2a78c0`) as the
   accent token. We do **not** fetch the per-user accent preference (`accent.ts`) from
   the backend this epic — that's a later enhancement once the foundation is solid.

### Why a theme module, not per-file styles

The core problem isn't ugliness, it's that there's **no foundation**. As we add
screens (settlement, dashboard, transaction entry, …) each one currently reinvents its
palette. A single `lib/theme.ts` makes every future screen cheap and consistent, and
makes the eventual dark-mode / per-user-accent / bundled-font changes single-point
edits instead of repo-wide sweeps.

---

## Reference points

- `frontend/src/styles/tokens.css` — source of truth for the values we port (spacing
  scale, type scale, Graphite colors, accent, `--card-*` surface, radius, durations).
  Mobile mirrors the **light** `:root` block; the `[data-theme='dark']` block is the
  future dark variant.
- `mobile/app/(app)/groups/[id].tsx` — the anchor layout (header / tab bar / cards).
- `mobile/components/BalanceCard.tsx` — the cleanest existing card; the restyle target
  that proves the token model.
- Current hardcoded palette to retire: `#2563eb` (accent → `#2a78c0`), `#f0f2f5`
  (desktop bg), `#fff` (card/inset), `#e0e0e0`/`#f0f0f0` (rules), `#1a1a1a`/`#888`
  (text/muted), `#27ae60`/`#e74c3c` (amount pos/neg → `#007700`/`#cc0000`).

---

## Token model (`mobile/lib/theme.ts`)

A typed object, not CSS. Shape mirrors the web tokens so the mapping is obvious:

```ts
export const theme = {
  sp:   { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, '2xl': 48, '3xl': 64 },
  text: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 32 },
  weight: { normal: '400', medium: '500', semibold: '700' },
  font: { sans: undefined /* system */, mono: 'monospace' },
  radius: { sm: 0, md: 0, lg: 2, xl: 4 }, // sharp, per design system
  color: {
    desktop: '#b8bcc2',
    window: '#f4f5f7', windowRaised: '#eceef2', windowInset: '#ffffff',
    rule: '#c8ccd2', ruleSoft: '#e2e5ea',
    text: '#1a1f28', textMuted: '#5a6068', textDisabled: '#8a909a',
    accent: '#2a78c0', accentHi: '#5aa8e8', accentChipBg: '#dde6f2', accentChipFg: '#1a3868',
    success: '#007700', warning: '#b86800', danger: '#cc0000',
    amountPositive: '#007700', amountNegative: '#cc0000',
    transferIn: '#006e8a', transferOut: '#4a5fa8',
  },
  // Aqua card surface — RN-approximated: flat bg + hairline border + soft elevation.
  card: {
    bg: '#f4f5f7', border: '#c8ccd2', radius: 2,
    // RN elevation/shadow props, not a CSS string:
    shadow: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  },
  duration: { fast: 80, normal: 120 },
} as const
```

(Exact values reconciled against `tokens.css` during story 1; the above is the shape.)

---

## Stories

### 1. Token foundation + theme module

Create `mobile/lib/theme.ts` mirroring the web light tokens (spacing, type, weight,
radius, Graphite colors, accent, amounts, card surface). Export a typed `theme` object
and small helpers as needed (e.g. a `card()` style spreader). No screen changes beyond
a single proof-of-concept conversion (BalanceCard) to validate the model reads well in
`StyleSheet.create`. Document the web-token → mobile-token mapping in this file.

**Done when:** `theme.ts` exists, is typed, BalanceCard renders from it with no
hardcoded hex, and the look matches the group page's card aesthetic.

### 2. App shell — header, tab bars, surfaces

Restyle the navigation chrome to the Graphite palette using tokens:

- Bottom tab navigator (`app/(app)/_layout.tsx`) — Graphite tab bar, accent active
  tint (`#2a78c0`), token border/label sizes. Replace emoji tab icons with a
  consistent icon treatment (decide: keep emoji vs. a lightweight icon set — note in
  PR).
- Screen header pattern (back + centered title) and the in-screen 4-tab underline bar
  from the group page, extracted to a reusable styled component so every screen shares
  one header/tab implementation.
- Page background → `desktop`; cards → `card` surface.

**Done when:** Groups list, group detail, and settings all share one tokenized
header/tab/background system.

### 3. Fish-pie group screens — the anchor, fully on-brand

Convert the group experience end-to-end against tokens, since it's the reference:
`BalanceCard` (done in story 1 — verify), `ExpenseForm`, `ExpenseList`,
`SettlementList`, `GroupSettingsPanel`, `AccountPicker`, `InviteRow`. Category chips,
payer chips, amount colors, list rows, and section labels all from tokens. This is the
screen Lester sees most — it should look finished.

**Done when:** every component rendered under the group tabs uses tokens, zero
hardcoded hex, and matches the agreed Aqua-card aesthetic.

### 4. Groups list, Settings, Login polish

Apply the same tokens to the remaining screens: groups list rows + create-group modal,
the settings screen, and the login screen (`app/(auth)/login.tsx` — the one file that
already has a local style notion; fold it into the shared theme). Empty/error/loading
states get consistent tokenized treatment.

**Done when:** no `StyleSheet` in `mobile/` references a raw hex that isn't a token;
all five screens read as one app.

### 5. Sweep + guardrail

Grep the tree for stray hex/`borderRadius`/magic numbers; fold any remaining into
tokens. Add a short `mobile/README` note (or a comment in `theme.ts`) establishing the
rule: **new mobile UI uses `theme` tokens, never raw values** — the mobile equivalent
of the web design-system rule. Optionally a lightweight lint/grep check.

**Done when:** `grep -rE '#[0-9a-fA-F]{6}' mobile/app mobile/components` returns only
`theme.ts`, and the convention is written down.

---

## Out of scope

- **Dark mode wiring.** Token structure anticipates it; the flip is a later epic.
- **Per-user accent preference** from the backend (`accent.ts`). Fixed default for now.
- **Bundled custom font.** System font; token leaves the door open.
- **XP bevel chrome.** Explicitly rejected for mobile in favor of the Aqua-card subset.
- **New features / screens.** This epic restyles what exists; it doesn't add
  settlement, dashboard, or transaction-entry screens (those land later, and will be
  cheap *because* of this foundation).

## Sequencing notes

- Story 1 unblocks everything; 2 (shell) and 3 (group screens) are the bulk; 4 cleans
  up the rest; 5 locks the convention.
- Each story ships as its own PR against `main` per the normal epic workflow.
