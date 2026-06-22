# Epic: Companion Theming (Light/Dark + Accents)

Goal: Bring runtime theming to the mobile app — a **light/dark mode** switch and a **multiple-accent** picker, matching the web app's capability and staying *stylistically aligned* with it (shared token shape, not necessarily identical hex values). The mobile palette keeps its warm/rust Companion identity; this epic makes it swappable rather than frozen.

**Depends on:** nothing hard, but best sequenced *after* the Companion Payment Row epic so we re-theme a settled layout. Stylistic reference: the web `frontend/src/styles/tokens.css` light/dark + accent system and the archived **Accent Color Preference** web epic.

## Background

`mobile/lib/theme.ts` is a single frozen module-level `const`. Every component reads `theme.color.x` at `StyleSheet.create()` time — captured once at module load. That's why the app can't currently swap palette at runtime: the styles are already baked. Supporting light/dark + accents means restructuring how the palette is produced and consumed.

The web app already does light/dark and 6 matched accents via CSS variables (`tokens.css`). We want the *same shape* on mobile so the two platforms feel like one product:

- A **neutral structural layer** (surfaces, ink, lines) that flips with light/dark mode.
- An **accent layer** (rust today) that's swappable independently of mode.
- The palette resolved from `(mode, accent)` at runtime and delivered through React context, so a toggle re-renders the tree with new colors.

The constraint to design around: RN `StyleSheet.create` captures values eagerly. The migration converts components from module-level static styles that read `theme.color.*` to styles derived from a `useTheme()` palette (via `useMemo(() => makeStyles(t), [t])` or inline style objects). This is a sweep across every component — hence its own epic.

We lock the **token names** now (in the Payment Row epic we already read from `theme.color.*`) so the structural rename happens once here, not twice.

### Design decisions to settle in the epic (before coding)

- **Palette model:** define the neutral layer as two complete sets (`light`, `dark`) and the accent layer as N named accent sets (`{ accent, accentSoft, accentLine, accentInk, accentGlossTop, accentGlossBorder }`). The resolved `color` object = neutral[mode] merged with accent[key]. Decide the dark-mode neutral hexes (the handoff has a future dark set — use it as the starting point) and the accent roster (mirror web's 6, re-tuned warm, or a Companion-specific set).
- **Status colors** (green/red) — decide whether they shift per mode or stay fixed.
- **Gloss recipe** — the white-sheen overlays assume light surfaces. Dark mode needs a revised sheen (lower white opacity, possibly a subtle top highlight only). Decide the dark gloss constants.
- **Persistence:** mode + accent stored in `AsyncStorage` (device-local) — these are display prefs, not synced to the server. Confirm vs. syncing to `user_settings` like web (web persists accent server-side; mobile may diverge and stay local — call it out).
- **Default mode:** follow OS appearance (`useColorScheme()`) on first run, with an explicit override once the user picks.

---

## Stories

### 1. Restructure `theme.ts` into a palette factory

`mobile/lib/theme.ts` (+ new `lib/palette.ts`, tested).

- Split the static, mode-independent tokens (`sp`, `text`, `weight`, `font`, `radius`, `duration`) — these stay frozen and shared.
- Introduce `neutral: { light, dark }` and `accents: Record<AccentKey, AccentSet>`.
- `makePalette(mode, accentKey): Palette` — pure function merging neutral[mode] + accents[accentKey] + resolved gloss constants. Unit-tested (every mode×accent resolves a complete palette; no missing keys).
- Keep a `defaultTheme` export (light + rust) so non-migrated code still compiles during the migration.

### 2. Theme context + `useTheme()` hook

`mobile/lib/theme-context.tsx` + `app/_layout.tsx`.

- `ThemeProvider` holding `(mode, accentKey)` state, hydrated from `AsyncStorage` (falling back to `useColorScheme()` for mode, rust for accent). Persists changes.
- `useTheme()` returns the resolved palette + the static tokens + setters (`setMode`, `setAccent`).
- Wrap the app at `_layout.tsx`. Handle the hydration flash (don't render the tree until prefs are read, or render with the OS-appropriate default).

### 3. Migrate components to `useTheme()`

The sweep. Convert each component in `mobile/components/` (and any screen reading `theme.color.*`) from static `StyleSheet.create` referencing the frozen `theme` to palette-aware styles via `useTheme()`.

- Establish the pattern on 2–3 representative components first (a chip, a card/`GlossSurface`, the `AmountHero`), agree on it, then roll out.
- Static tokens (spacing, radius, fonts) keep coming from the frozen import — only *color* moves to the hook.
- The `GlossLayers` / `GlossSurface` primitives need the dark gloss constants from Story 1.
- Retire the legacy Graphite aliases in `color` (the comment in `theme.ts` notes they were to be removed post-migration) where they're no longer referenced.

This is large; break it into sub-batches by screen (Add, Balances, History, Settings, Account, shared components) so each is a reviewable PR if needed.

### 4. Settings UI — mode toggle + accent picker

`mobile/app/(app)/settings.tsx` (+ a new `AccentPicker` / `ModeToggle` component).

- A light/dark/system segmented control.
- An accent swatch grid (mirrors the web `AccentPicker` interaction: tap a swatch → applies immediately, persists). Each swatch previews its accent gradient.
- Both apply optimistically via the Story 2 setters.

### 5. Verify parity + polish

- Walk every screen in both modes × a couple accents; check contrast (ink on surface, text-on-accent), gloss legibility, focus/selected states.
- Confirm `lint:tokens` still passes (no hardcoded colors leaked in during the sweep).
- Note any web/mobile divergences deliberately (different hexes are fine; the *shape* and feel must align).

---

## Out of scope

- Server-syncing the theme choice across devices (mobile stays device-local unless we decide to mirror web's server persistence — open question in the design section).
- Per-group or per-screen theming.
- New accent *colors* on the web side (this epic only consumes/aligns with what web already defines).
