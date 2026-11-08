// What an undo step is called, so the menu can name it: "Undo write Lunch". The words are in
// `copy/steps.ts`, one for every kind.

export type StepName =
  | { kind: 'write'; description: string }
  | { kind: 'edit'; description: string }
  | { kind: 'remove'; description: string }
  | { kind: 'addAccount'; name: string }
  | { kind: 'start'; name: string }
