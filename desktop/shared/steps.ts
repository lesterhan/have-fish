// What an undo step is called, so the menu can name it: "Undo write Lunch". The words are in
// `copy/steps.ts`, one for every action.

import type { AccountStep } from './commands/accounts'
import type { RateStep } from './commands/rates'
import type { SpendStep } from './commands/spends'

export type StepName = SpendStep | AccountStep | RateStep
