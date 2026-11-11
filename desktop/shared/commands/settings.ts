// What this machine's settings ask of main: its theme and its density.

import { z } from 'zod'
import { DENSITIES, type Density } from '../density'
import { THEME_CHOICES, type ThemeChoice } from '../theme/theme'

export const settingsInputs = {
  /** This machine's theme: never the ledger's. */
  'settings.theme.set': z.strictObject({ theme: z.enum(THEME_CHOICES) }),
  /** How tightly this machine sets the ledger: never the ledger's. */
  'settings.density.get': z.strictObject({}),
  'settings.density.set': z.strictObject({ density: z.enum(DENSITIES) }),
}

export interface SettingsValues {
  'settings.theme.set': { theme: ThemeChoice }
  'settings.density.get': { density: Density }
  'settings.density.set': { density: Density }
}
