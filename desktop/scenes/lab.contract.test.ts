// failuresOf against a contract that fails a step, which no theme the schema takes does today.

import { expect, test, vi } from 'vitest'
import type { InkFailure, StepFailure } from '../shared/theme/contract'
import { BUILT_IN_LAB, failuresOf } from './lab'

const ink: InkFailure = {
  scheme: 'light',
  ink: '--color-income',
  on: '--color-sidebar',
  ratio: 4.45,
  needs: 4.5,
}
const step: StepFailure = {
  problem: 'flat',
  scheme: 'dark',
  from: '--color-background',
  to: '--color-band',
  step: 0.031,
  needs: 0.04,
}

vi.mock('../shared/theme/contract', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/theme/contract')>()),
  inkFailures: () => [ink],
  stepFailures: () => [step],
}))

test("failuresOf keeps the contract's ink failures, then its step failures", () => {
  expect(failuresOf(BUILT_IN_LAB)).toEqual([ink, step])
})
