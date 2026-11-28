// How the guessed rates' popover closes, as an action on its layer: Escape, the cursor leaving
// it, or a click outside while a write waits. A disabled control's blur, while it waits, comes
// with no focusout of the click after it, so that click is caught on the window.

/** While a write waits, and what closes the popover; `back` gives the tree the cursor. */
export type Dismissing = { waiting: () => boolean; onclose: (back: boolean) => void }

/** Where a click lands: in the popover, on a control outside it, or on nothing. */
type Click = 'in' | 'control' | 'nothing'

/** Where a click at `target` lands, `layer` being the popover's. */
function clickOf(target: EventTarget | null, layer: Node): Click {
  if (target instanceof Node && layer.contains(target)) return 'in'
  const control =
    target instanceof Element && target.closest('button, input, select, textarea, a, [tabindex]')
  return control === null || control === false ? 'nothing' : 'control'
}

/** What a blur out of the popover means: stay, close back to the tree, or close where it went. */
type Leaving = 'stay' | 'back' | 'away'

/**
 * What a cursor leaving `layer` means, with `target` what had it and `next` where it went: stay
 * while it went into the popover, or while an answer took the control away or disabled it.
 */
function leaveOf(target: EventTarget | null, next: EventTarget | null, layer: Node): Leaving {
  if (next instanceof Node && layer.contains(next)) return 'stay'
  if (target instanceof Node && !target.isConnected) return 'stay'
  if (target instanceof HTMLElement && target.matches(':disabled')) return 'stay'
  return next === null ? 'back' : 'away'
}

/** How a popover closes: Escape, the cursor leaving it, or a click outside while a write waits. */
export function dismiss(layer: HTMLElement, how: Dismissing) {
  let current = how

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') current.onclose(true)
  }

  // A click on another control keeps the cursor there, one on nothing gives the tree the cursor,
  // and a window that lost the cursor keeps the popover as it was.
  function focusout(event: FocusEvent) {
    if (!document.hasFocus()) return
    const leaving = leaveOf(event.target, event.relatedTarget, layer)
    if (leaving !== 'stay') current.onclose(leaving === 'back')
  }

  function pointerdown(event: PointerEvent) {
    if (!current.waiting()) return
    const click = clickOf(event.target, layer)
    if (click === 'in') return
    // Nothing takes the cursor: the click mustn't put it on the page after the tree has it.
    if (click === 'nothing') event.preventDefault()
    current.onclose(click === 'nothing')
  }

  layer.addEventListener('keydown', keydown)
  layer.addEventListener('focusout', focusout)
  window.addEventListener('pointerdown', pointerdown, true)
  return {
    update(next: Dismissing) {
      current = next
    },
    destroy() {
      layer.removeEventListener('keydown', keydown)
      layer.removeEventListener('focusout', focusout)
      window.removeEventListener('pointerdown', pointerdown, true)
    },
  }
}
