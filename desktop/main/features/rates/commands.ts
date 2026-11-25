// The rates' command: writing one I typed.

import type { rateInputs } from '../../../shared/commands'
import type { HandlersFor } from '../../commands/handlers'
import { writeRate } from './rates'

export const handlers: HandlersFor<keyof typeof rateInputs> = {
  'rate.write': writeRate,
}
