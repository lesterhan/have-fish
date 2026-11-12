// This machine's settings' commands: its theme and its density, never the ledger's.

import type { settingsInputs } from '../../../shared/commands'
import type { HandlersFor } from '../../commands/handlers'
import { getDensity, setDensity, setTheme } from './settings'

export const handlers: HandlersFor<keyof typeof settingsInputs> = {
  'settings.theme.set': setTheme,
  'settings.density.get': getDensity,
  'settings.density.set': setDensity,
}
