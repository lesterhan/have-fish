/**
 * Tooltip action — appends a fixed-position tooltip div to <body> on hover.
 * Appending to body avoids clipping by ancestor overflow:hidden elements.
 *
 * Usage:
 *   <element use:tooltip={'Label text'}>
 *   <element use:tooltip={{ label: 'Label', always: true }}>
 *
 * By default the tooltip is suppressed when the nearest .sidebar ancestor is
 * not collapsed, so it only appears in the collapsed strip where labels aren't
 * visible. Pass `always: true` to show regardless of sidebar state.
 */
type TooltipParam = string | { label: string; always?: boolean } | undefined

export function tooltip(node: HTMLElement, param: TooltipParam) {
  let label = typeof param === 'string' ? param : (param?.label ?? '')
  let always = typeof param === 'string' ? false : (param?.always ?? false)
  let el: HTMLDivElement | null = null

  function place(x: number, y: number) {
    if (!el) return
    const gap = 14
    const tw = el.offsetWidth
    const th = el.offsetHeight
    const left = Math.min(x + gap, window.innerWidth - tw - 4)
    const top = Math.min(y + gap, window.innerHeight - th - 4)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }

  function show(e: MouseEvent) {
    if (!label) return

    // Suppress when inside an expanded sidebar (labels are already visible).
    const sidebar = node.closest('.sidebar')
    if (!always && sidebar && !sidebar.classList.contains('collapsed')) return

    el = document.createElement('div')
    el.className = 'hf-tooltip'
    el.textContent = label
    document.body.appendChild(el)
    place(e.clientX, e.clientY)
  }

  function move(e: MouseEvent) {
    place(e.clientX, e.clientY)
  }

  function hide() {
    el?.remove()
    el = null
  }

  function showOnKeyboard(e: FocusEvent) {
    if (!node.matches(':focus-visible')) return
    const rect = node.getBoundingClientRect()
    show({ clientX: rect.left, clientY: rect.bottom } as MouseEvent)
  }

  node.addEventListener('mouseenter', show)
  node.addEventListener('mousemove', move)
  node.addEventListener('mouseleave', hide)
  node.addEventListener('click', hide)
  node.addEventListener('focusin', showOnKeyboard)
  node.addEventListener('focusout', hide)

  return {
    update(newParam: TooltipParam) {
      label = typeof newParam === 'string' ? newParam : (newParam?.label ?? '')
      always =
        typeof newParam === 'string' ? false : (newParam?.always ?? false)
    },
    destroy() {
      node.removeEventListener('mouseenter', show)
      node.removeEventListener('mousemove', move)
      node.removeEventListener('mouseleave', hide)
      node.removeEventListener('click', hide)
      node.removeEventListener('focusin', showOnKeyboard)
      node.removeEventListener('focusout', hide)
      el?.remove()
    },
  }
}
