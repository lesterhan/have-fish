// The Edit menu's Undo and Redo, naming the step each would take back or put back.

import type { StepName } from '../shared/steps'

/** Words for every kind of step, so a new kind fails `bun run check` until it has some. */
type Words = { [K in StepName['kind']]: (step: Extract<StepName, { kind: K }>) => string }

const undo: Words = {
  write: ({ description }) => (description ? `Undo write ${description}` : 'Undo write a spend'),
  edit: ({ description }) => (description ? `Undo edit ${description}` : 'Undo edit a spend'),
  saveAll: ({ count }) => (count === 1 ? 'Undo save 1 spend' : `Undo save ${count} spends`),
  remove: ({ description }) => (description ? `Undo remove ${description}` : 'Undo remove a spend'),
  addAccount: ({ name }) => `Undo add account ${name}`,
}

const redo: Words = {
  write: ({ description }) => (description ? `Redo write ${description}` : 'Redo write a spend'),
  edit: ({ description }) => (description ? `Redo edit ${description}` : 'Redo edit a spend'),
  saveAll: ({ count }) => (count === 1 ? 'Redo save 1 spend' : `Redo save ${count} spends`),
  remove: ({ description }) => (description ? `Redo remove ${description}` : 'Redo remove a spend'),
  addAccount: ({ name }) => `Redo add account ${name}`,
}

export const steps = { undo, redo }
