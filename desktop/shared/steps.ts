// What an undo step is called, so the menu can name it: "Undo write Lunch". The words are in
// `copy/steps.ts`, one for every kind.

import type { AccountStep } from './commands/accounts'
import type { SpendStep } from './commands/spends'

export type StepName = SpendStep | AccountStep
