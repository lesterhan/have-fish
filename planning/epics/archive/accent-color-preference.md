# Epic: Accent Color Preference

**Design source:** `https://api.anthropic.com/v1/design/h/bMNvShdaIYcW6G1dX7rIfQ?open_file=Spending+v3.html`
Reference files in the bundle: `have-fish/project/src/v3-accents.jsx` (6 accent definitions), `have-fish/project/src/v3-app.jsx` (tweaks panel for picker pattern).

**Depends on:** Graphite Design System epic (accent CSS vars must exist).

Goal: Let users pick from 6 accent colors by clicking the app title / pill in the title bar. The choice persists in `preferences` in `user_settings`.

## Background

The design has 6 accents — all matched in chroma/lightness so none burn the eye:
- Aqua `#2a78c0`, Sage `#4a8a5a`, Persimmon `#c46838`, Plum `#8a4a8a`, Ochre `#b89028`, Slate `#5a6878`

The `preferences` JSONB column in `user_settings` already exists and supports shallow-merge via `PATCH /user-settings`. No DB migration needed. We add `accentColor: AccentKey` to the `UserPreferences` type, load it on app startup, and apply it via `applyAccent()` from the Graphite Design System epic.

The picker is triggered by clicking the app name or the accent-colored pill in the title bar (the "have-fish" or "Fish Pie" text/pill). It shows a small popover with 6 color swatches.

## Stories

### 1. Extend `UserPreferences` type and load accent on startup

`frontend/src/lib/api.ts` and `frontend/src/routes/+layout.svelte`.

Add `accentColor?: AccentKey` to `UserPreferences`. In `+layout.svelte`, after `fetchUserSettings()` resolves, call `applyAccent(settings.preferences.accentColor ?? 'aqua')`. This replaces the hardcoded default call from the Graphite Design System epic.

### 2. Build `AccentPicker.svelte` component

`frontend/src/lib/components/AccentPicker.svelte`.

A small popover (not a modal) that appears anchored below the trigger element. Shows 6 swatches in a 2×3 or 3×2 grid. Each swatch is a 20×20px square with the accent color as a gradient (from `hi` to `hex`), a 1px border, and a checkmark overlay on the active one.

Props:
```ts
interface Props {
  current: AccentKey
  onselect: (key: AccentKey) => void
  onclose: () => void
}
```

Clicking a swatch calls `onselect`. Clicking outside (or pressing Escape) calls `onclose`. Style the popover with Graphite shell tokens — white/`--color-window` background, `--color-sidebar-border` border, `--shadow-raised` shadow.

### 3. Integrate picker into the title bar

`frontend/src/routes/+layout.svelte` (or the title bar region of the app shell).

The title bar currently shows the app name. Add a small pill/badge next to it (or style the name itself as clickable) in the current `--color-accent` color. Clicking it:
1. Opens the `AccentPicker` popover
2. On swatch selection: call `applyAccent(key)` immediately (optimistic), close picker, PATCH preferences

The title bar pill styling (from `v3-hybrid.jsx`): a small rounded badge showing the app name or a dot, with background `--color-titlebar-accent` (the per-accent gradient). On hover, show a cursor + subtle brightness change.

### 4. Persist accent to backend

When the user selects an accent, call:
```ts
await updateUserSettings({ preferences: { accentColor: key } })
```
This shallow-merges into the existing preferences. Handle errors silently (the UI already reflects the choice optimistically).

Update `settingsStore` so the stored value reflects the new accent for future page loads.
