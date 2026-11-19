// Puts a floating layer under its field, fixed to the window: the field's row or card clips what
// is inside it, and a picker must be able to spill over both. Floating UI places it and follows
// the field as the list scrolls, the window resizes, or the field itself changes size; with no
// room below, it flips above. `below` is where the layer starts when that isn't the field's own
// bottom: the composer's whole line, so it clears the ring. `--room` is the height it has.

import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  size,
  type VirtualElement,
} from '@floating-ui/dom'

/** An element bound with `bind:this`: undefined until drawn, and null once it's gone. */
type Bound = HTMLElement | null | undefined

export type Anchor = Bound | { field: Bound; below: Bound }

/** The gap between the field and its layer, and the least it keeps from the window's edge. */
const GAP = 4
const EDGE = 8

/** What the layer hangs from: the field, or a box as wide as the field and as tall as `below`. */
function referenceOf(anchor: Anchor): HTMLElement | VirtualElement | null {
  if (anchor instanceof HTMLElement) return anchor
  if (anchor === undefined || anchor === null) return null
  const { field, below } = anchor
  if (!(field instanceof HTMLElement)) return null
  if (!(below instanceof HTMLElement)) return field
  return {
    contextElement: field,
    getBoundingClientRect() {
      const at = field.getBoundingClientRect()
      const line = below.getBoundingClientRect()
      return new DOMRect(at.left, line.top, at.width, line.height)
    },
  }
}

export function floating(node: HTMLElement, anchor: Anchor) {
  node.style.position = 'fixed'
  let stop = () => {}

  function follow(next: Anchor) {
    stop()
    const reference = referenceOf(next)
    if (reference === null) {
      stop = () => {}
      return
    }
    const place = async () => {
      const { x, y } = await computePosition(reference, node, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [
          offset(GAP),
          flip({ padding: EDGE }),
          size({
            padding: EDGE,
            apply({ availableHeight, rects }) {
              node.style.minInlineSize = `${rects.reference.width}px`
              node.style.setProperty('--room', `${Math.max(0, availableHeight)}px`)
            },
          }),
        ],
      })
      node.style.insetInlineStart = `${x}px`
      node.style.top = `${y}px`
    }
    stop = autoUpdate(reference, node, () => void place())
  }

  follow(anchor)
  return {
    update: follow,
    destroy: () => stop(),
  }
}
