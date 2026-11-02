// What the Edit menu's Undo and Redo say, and whether they can be chosen: the focused field's
// typing first, else the history's next step by name, else greyed out.

import { copy } from '../../copy'
import type { Typing } from '../../shared/commands'
import type { StepName } from '../../shared/steps'
import type { History } from './history'
import type { Step } from './steps'

export type Item = { label: string; enabled: boolean }
export type UndoItems = { undo: Item; redo: Item }

export function undoItems(history: History<Step>, typing: Typing): UndoItems {
  const { labels } = copy.actions
  const item = (way: 'undo' | 'redo', next: Step | undefined): Item => {
    if (typing[way]) return { label: copy.actions.typing[way], enabled: true }
    if (next === undefined) return { label: labels[way], enabled: false }
    return { label: named(way, next.name), enabled: true }
  }
  return { undo: item('undo', history.nextUndo()), redo: item('redo', history.nextRedo()) }
}

/** What the window says about its typing, trusted only as far as two booleans. */
export function typingFrom(said: unknown): Typing {
  const { undo, redo } = (typeof said === 'object' && said !== null ? said : {}) as Partial<Typing>
  return { undo: undo === true, redo: redo === true }
}

function named(way: 'undo' | 'redo', name: StepName): string {
  const words = copy.steps[way]
  switch (name.kind) {
    case 'write':
      return words.write(name)
    case 'edit':
      return words.edit(name)
    case 'saveAll':
      return words.saveAll(name)
    case 'remove':
      return words.remove(name)
  }
}
