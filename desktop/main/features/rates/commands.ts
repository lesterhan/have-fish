// The rates' commands: writing one I typed or several as one step, and fetching them.

import type { rateInputs } from '../../../shared/commands'
import type { HandlersFor } from '../../commands/handlers'
import { fetchRates, writeAllRates, writeRate } from './rates'

export const handlers: HandlersFor<keyof typeof rateInputs> = {
  'rate.write': writeRate,
  'rate.writeAll': writeAllRates,
  'rate.fetch': fetchRates,
}
