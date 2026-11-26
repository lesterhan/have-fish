// The rates' commands: writing one I typed, or several as one step.

import type { rateInputs } from '../../../shared/commands'
import type { HandlersFor } from '../../commands/handlers'
import { writeAllRates, writeRate } from './rates'

export const handlers: HandlersFor<keyof typeof rateInputs> = {
  'rate.write': writeRate,
  'rate.writeAll': writeAllRates,
}
