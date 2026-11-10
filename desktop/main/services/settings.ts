// The machine's own settings, chosen from the menu. None of them touch the ledger.

import type { Outcome } from '@have-fish/core/outcome'
import type { Density } from '../../shared/density'
import type { ThemeChoice } from '../../shared/theme/theme'
import type { Context } from '../context'

/** Remembers the theme for the next launch, and repaints the window now. */
export function setTheme(
  ctx: Context,
  { theme }: { theme: ThemeChoice },
): Outcome<{ theme: ThemeChoice }> {
  ctx.machine.chooseTheme(theme)
  ctx.showTheme(theme)
  return { ok: true, value: { theme } }
}

/** The density this machine is set in: the window reads it when it opens. */
export function getDensity(ctx: Context): Outcome<{ density: Density }> {
  return { ok: true, value: { density: ctx.machine.density() } }
}

/** Remembers the density for the next launch; the window shows what main kept. */
export function setDensity(
  ctx: Context,
  { density }: { density: Density },
): Outcome<{ density: Density }> {
  ctx.machine.chooseDensity(density)
  return { ok: true, value: { density } }
}
