// Puts a floating layer under its field, fixed to the window: the field's row or card clips what
// is inside it, and a picker must be able to spill over both. `update` follows the field as the
// list scrolls, the window resizes, or the field itself changes size. `below` is where the layer
// starts when that isn't the field's own bottom: the composer's whole line, so it clears the ring.

/** An element bound with `bind:this`: undefined until drawn, and null once it's gone. */
type Bound = HTMLElement | null | undefined

export type Anchor = Bound | { field: Bound; below: Bound }

export function floating(node: HTMLElement, anchor: Anchor) {
  const parts = (from: Anchor) =>
    from instanceof HTMLElement
      ? { field: from, below: from }
      : from === undefined || from === null
        ? { field: undefined, below: undefined }
        : from
  let { field, below } = parts(anchor)
  const place = () => {
    if (!(field instanceof HTMLElement)) return
    const fieldRect = field.getBoundingClientRect()
    const under = (below ?? field).getBoundingClientRect()
    node.style.position = 'fixed'
    node.style.insetInlineStart = `${fieldRect.left}px`
    node.style.top = `${under.bottom + 4}px`
    node.style.minInlineSize = `${fieldRect.width}px`
  }
  place()
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  const observer = new ResizeObserver(place)
  for (const el of [field, below]) if (el instanceof HTMLElement) observer.observe(el)
  return {
    update(next: Anchor) {
      for (const el of [field, below]) if (el instanceof HTMLElement) observer.unobserve(el)
      ;({ field, below } = parts(next))
      for (const el of [field, below]) if (el instanceof HTMLElement) observer.observe(el)
      place()
    },
    destroy() {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      observer.disconnect()
    },
  }
}
