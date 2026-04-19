# Epic: Graphite Design System

**Design source:** `https://api.anthropic.com/v1/design/h/bMNvShdaIYcW6G1dX7rIfQ?open_file=Spending+v3.html`
Reference files in the bundle: `have-fish/project/src/v3-accents.jsx` (all color tokens), `have-fish/project/src/v3-hybrid.jsx` (layout).

Goal: Overhaul `tokens.css` and global styles from the current XP teal/blue palette to the **Graphite** base palette from the design. This is the foundation — all subsequent visual epics depend on these tokens being correct.

## Background

The current design uses `--color-desktop: #008080` (teal) and XP navy/sky title bars. The new direction commits to a **Graphite shell** — a cool silver-grey base that reads as a real desktop application while letting a user-chosen accent color provide all the personality. The teal desktop is replaced; the XP bevel language stays but is applied more selectively.

The accent color becomes a runtime CSS custom property (`--color-accent` and related) that can be swapped without a page reload. This epic wires up the token system for that; the actual picker UI lives in the Accent Color Preference epic.

Key Graphite base values (from `v3-accents.jsx`):
- Desktop: `#b8bcc2`
- Window border: `#3a3f48`
- Title bar: `linear-gradient(180deg, #d8dde4 0%, #a8aeb8 50%, #8a909a 100%)`
- Panel bg: `#f4f5f7`, panel bg alt: `#eceef2`
- Sidebar bg: `#e2e5ea`, sidebar border: `#8a909a`
- Rule: `#c8ccd2`, rule soft: `#e2e5ea`
- Section bar (breakdown headers): `linear-gradient(180deg, #5a6068, #2a3038)`, fg: `#f0f2f4`
- Status bar bg: `#cfd3d8`
- Body color: `#1a1f28`
- Muted: `#5a6068`

Typography (from `v3-accents.jsx`):
- Body: `'Lucida Grande', 'Segoe UI', Tahoma, sans-serif`
- Mono: `'JetBrains Mono', Consolas, monospace` — for all numbers and data
- Serif: `'Source Serif 4', Georgia, serif` — for section headers and month label

Accent seed (default aqua, overridden at runtime):
- `--color-accent: #2a78c0`
- `--color-accent-hi: #5aa8e8` (highlight/icon tint)
- `--color-accent-chip-bg: #dde6f2`
- `--color-accent-chip-fg: #1a3868`
- `--color-accent-bar-track: #dde6f2`
- `--color-titlebar-accent: linear-gradient(180deg, #5aa8e8, #2a78c0)` — used on title bar icon/pill

## Stories

### 1. Update `tokens.css` — Graphite palette

`frontend/src/styles/tokens.css`.

Replace the desktop, window chrome, title bar, and panel color tokens with the Graphite values above. Keep the existing spacing scale, radius, shadow, and transition tokens untouched — they still apply. Add new tokens:
- `--color-desktop` → `#b8bcc2`
- `--color-window` → `#f4f5f7` (panel bg)
- `--color-window-raised` → `#eceef2` (panel bg alt)
- `--color-window-inset` → `#ffffff`
- `--color-sidebar` → `#e2e5ea`
- `--color-sidebar-border` → `#8a909a`
- `--color-titlebar-bg` → the graphite gradient string
- `--color-titlebar-fg` → `#1a1f28`
- `--color-section-bar-bg` → the dark gradient string
- `--color-section-bar-fg` → `#f0f2f4`
- `--color-section-bar-border-top` → `#7a808a`
- `--color-section-bar-border-bottom` → `#0a1018`
- `--color-rule` → `#c8ccd2`
- `--color-rule-soft` → `#e2e5ea`
- `--color-text` → `#1a1f28`
- `--color-text-muted` → `#5a6068`
- Accent vars (defaults, overridden at runtime — see story 3):
  - `--color-accent`, `--color-accent-hi`, `--color-accent-chip-bg`, `--color-accent-chip-fg`, `--color-accent-bar-track`, `--color-titlebar-accent`

### 2. Add font imports and update typography tokens

`frontend/src/styles/base.css` and `tokens.css`.

Add `@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@600;700&display=swap')` and `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap')` at the top of `base.css`.

Update typography tokens in `tokens.css`:
- `--font-sans` → `'Lucida Grande', 'Segoe UI', Tahoma, sans-serif`
- `--font-mono` → `'JetBrains Mono', Consolas, monospace`
- `--font-serif` → `'Source Serif 4', Georgia, serif`

### 3. Runtime accent CSS variable injection

`frontend/src/lib/accent.ts` (new file) + `frontend/src/routes/+layout.svelte`.

The 6 accent definitions (from `v3-accents.jsx`):
```ts
export const ACCENTS = {
  aqua:      { hex: '#2a78c0', hi: '#5aa8e8', chipBg: '#dde6f2', chipFg: '#1a3868', barTrack: '#dde6f2', titlebar: 'linear-gradient(180deg,#5aa8e8,#2a78c0)' },
  sage:      { hex: '#4a8a5a', hi: '#7ac08a', chipBg: '#dee8de', chipFg: '#1f4828', barTrack: '#dee8de', titlebar: 'linear-gradient(180deg,#7ac08a,#4a8a5a)' },
  persimmon: { hex: '#c46838', hi: '#e89868', chipBg: '#f0e0d4', chipFg: '#5a2a10', barTrack: '#f0e0d4', titlebar: 'linear-gradient(180deg,#e89868,#c46838)' },
  plum:      { hex: '#8a4a8a', hi: '#b878b8', chipBg: '#e8dee8', chipFg: '#3a103a', barTrack: '#e8dee8', titlebar: 'linear-gradient(180deg,#b878b8,#8a4a8a)' },
  ochre:     { hex: '#b89028', hi: '#e8c060', chipBg: '#efe6cc', chipFg: '#4a3408', barTrack: '#efe6cc', titlebar: 'linear-gradient(180deg,#e8c060,#b89028)' },
  slate:     { hex: '#5a6878', hi: '#8a98a8', chipBg: '#dde2e8', chipFg: '#1a2838', barTrack: '#dde2e8', titlebar: 'linear-gradient(180deg,#8a98a8,#5a6878)' },
} as const
export type AccentKey = keyof typeof ACCENTS

export function applyAccent(key: AccentKey) {
  const a = ACCENTS[key]
  const s = document.documentElement.style
  s.setProperty('--color-accent',            a.hex)
  s.setProperty('--color-accent-hi',         a.hi)
  s.setProperty('--color-accent-chip-bg',    a.chipBg)
  s.setProperty('--color-accent-chip-fg',    a.chipFg)
  s.setProperty('--color-accent-bar-track',  a.barTrack)
  s.setProperty('--color-titlebar-accent',   a.titlebar)
}
```

Call `applyAccent('aqua')` in `+layout.svelte` on mount (the default). The Accent Color Preference epic will wire the saved preference in instead.

### 4. Update shared components to compile under new tokens

Audit `Panel.svelte`, `Button.svelte`, `HeadingBanner.svelte`, `TableShell.svelte`. Any hardcoded references to the old teal `--color-desktop`, `--color-titlebar-from/to`, or the old banner gradient should be updated to the new token names. This is find-and-replace work — do not redesign the components themselves here; that belongs to later epics.
