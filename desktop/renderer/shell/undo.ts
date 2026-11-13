// Where Undo and Redo go: the focused field's own, while it holds typing of yours, else the
// ledger's. Chromium keeps one undo history for the whole window, and text the app set itself
// stays in it, so passing it a key with no typing behind it would undo something out of sight.

import { actionFor } from '../../shared/actions'
import type { Typing } from '../../shared/commands'

export type Way = 'undo' | 'redo'

type Keys = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

/** Which of Undo and Redo the keys press, by the list's shortcuts, if either. */
export function wayOf(e: Keys, mac: boolean): Way | null {
  for (const way of ['undo', 'redo'] as const) {
    const { accelerator, alternate } = actionFor(way)
    if (pressed(e, accelerator, mac)) return way
    if (!mac && alternate !== undefined && pressed(e, alternate, mac)) return way
  }
  return null
}

function pressed(e: Keys, accelerator: string, mac: boolean): boolean {
  const parts = accelerator.toLowerCase().split(/\+(?!$)/)
  const key = parts.pop()
  const cmdOrCtrl = parts.includes('cmdorctrl')
  return (
    e.key.toLowerCase() === key &&
    e.ctrlKey === (parts.includes('ctrl') || (cmdOrCtrl && !mac)) &&
    e.metaKey === (cmdOrCtrl && mac) &&
    e.shiftKey === parts.includes('shift') &&
    e.altKey === parts.includes('alt')
  )
}

/** A text field, as far as undo needs one. */
export type Field = { value: string }

/** Since you entered it: what it held then, what your last change left, and undos since typing. */
type State = { start: string; last: string; undone: number }

const NONE: Typing = { undo: false, redo: false }
const fresh = (value: string): State => ({ start: value, last: value, undone: 0 })

export class FieldUndo {
  #fields = new WeakMap<Field, State>()

  /** You entered `field`: its typing starts from what it holds now. */
  entered(field: Field): void {
    this.#fields.set(field, fresh(field.value))
  }

  /** Before you change `field`: if the app set its text since, the typing starts again from it. */
  changing(field: Field): void {
    this.#current(field)
  }

  /** `field` changed through you: typing, or its own undo or redo. */
  changed(field: Field, inputType: string): void {
    const state = this.#fields.get(field) ?? fresh(field.value)
    if (inputType === 'historyUndo') state.undone += 1
    else if (inputType === 'historyRedo') state.undone = Math.max(0, state.undone - 1)
    else state.undone = 0
    state.last = field.value
    this.#fields.set(field, state)
  }

  /** A save made the typing a step of the ledger, so Undo takes back the save instead. */
  forget(): void {
    this.#fields = new WeakMap()
  }

  /** Whether Undo and Redo would take back or put back `field`'s typing. */
  typing(field: Field | null): Typing {
    if (field === null) return NONE
    const state = this.#current(field)
    return { undo: field.value !== state.start, redo: state.undone > 0 }
  }

  /** Its state, started again if the app has set its text since your last change. */
  #current(field: Field): State {
    const state = this.#fields.get(field)
    if (state !== undefined && state.last === field.value) return state
    const started = fresh(field.value)
    this.#fields.set(field, started)
    return started
  }
}
