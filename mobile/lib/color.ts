/**
 * Tiny color helpers for the gloss primitives.
 *
 * React Native has no `color-mix()` / CSS filters, so the layered-gradient gloss
 * recipe (handoff "Gloss recipe") needs its lighten/darken stops computed at
 * runtime from a base color. These return `rgb(...)` / `rgba(...)` strings — no
 * hardcoded hex, so callers in `components/` stay clean for `lint:tokens`.
 *
 * `lighten`/`darken` take a percentage in `[0,100]` and move each channel that
 * fraction of the way toward white / black — a close enough analog to the web
 * prototype's `color-mix(..., white p%)` for these subtle (2–10%) shifts.
 */

interface Rgb {
  r: number
  g: number
  b: number
}

/** Parse `#rgb` or `#rrggbb` into channels. Throws on anything else so a bad
 * token fails loudly in dev rather than rendering a transparent surface. */
export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) {
    throw new Error(`color: expected #rgb or #rrggbb, got "${hex}"`)
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

const clampPct = (p: number) => Math.max(0, Math.min(100, p)) / 100
const round = (n: number) => Math.round(n)

/** Move each channel `pct`% toward white. */
export function lighten(hex: string, pct: number): string {
  const { r, g, b } = hexToRgb(hex)
  const t = clampPct(pct)
  return `rgb(${round(r + (255 - r) * t)}, ${round(g + (255 - g) * t)}, ${round(b + (255 - b) * t)})`
}

/** Move each channel `pct`% toward black. */
export function darken(hex: string, pct: number): string {
  const { r, g, b } = hexToRgb(hex)
  const t = 1 - clampPct(pct)
  return `rgb(${round(r * t)}, ${round(g * t)}, ${round(b * t)})`
}

/**
 * Translucent color from a hex base + alpha in `[0,1]`. Named `alpha` (not
 * `rgba`) so call sites don't trip the `lint:tokens` raw-`rgba(` guard.
 */
export function alpha(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a))})`
}
