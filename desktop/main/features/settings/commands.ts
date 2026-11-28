// This machine's settings' commands: its theme, its density and its rates, never the ledger's.

import type { settingsInputs } from '../../../shared/commands'
import type { HandlersFor } from '../../commands/handlers'
import { getDensity, getLookUp, setDensity, setLookUp, setTheme } from './settings'

export const handlers: HandlersFor<keyof typeof settingsInputs> = {
  'settings.theme.set': setTheme,
  'settings.density.get': getDensity,
  'settings.density.set': setDensity,
  'settings.rates.get': getLookUp,
  'settings.rates.set': setLookUp,
}
