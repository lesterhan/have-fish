// The machine's own settings, chosen from the menu. None of them touch the ledger.

import type { Outcome } from '@have-fish/core/outcome'
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
