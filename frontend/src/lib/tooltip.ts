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
type TooltipParam = string | { label: string; always?: boolean }

export function tooltip(node: HTMLElement, param: TooltipParam) {
  let label = typeof param === 'string' ? param : param.label
  let always = typeof param === 'string' ? false : (param.always ?? false)
  let el: HTMLDivElement | null = null

  function show() {
    // Suppress when inside an expanded sidebar (labels are already visible).
    // Outside a sidebar, always show.
    const sidebar = node.closest('.sidebar')
    if (!always && sidebar && !sidebar.classList.contains('collapsed')) return

    el = document.createElement('div')
    el.className = 'hf-tooltip'
    el.textContent = label
    document.body.appendChild(el)

    const rect = node.getBoundingClientRect()
    const gap = 8

    // offsetHeight/offsetWidth force layout so dimensions are available immediately
    const tw = el.offsetWidth
    const th = el.offsetHeight

    // Prefer right of the element; flip left if it would overflow the viewport
    const leftIfRight = rect.right + gap
    const leftIfLeft  = rect.left - gap - tw
    const left = leftIfRight + tw <= window.innerWidth ? leftIfRight : Math.max(0, leftIfLeft)

    // Centre vertically; clamp so it stays within the viewport
    const top = Math.min(
      Math.max(0, rect.top + (rect.height - th) / 2),
      window.innerHeight - th - gap,
    )

    el.style.left = `${left}px`
    el.style.top  = `${top}px`
  }

  function hide() {
    el?.remove()
    el = null
  }

  function showOnKeyboard() {
    if (node.matches(':focus-visible')) show()
  }

  node.addEventListener('mouseenter', show)
  node.addEventListener('mouseleave', hide)
  node.addEventListener('click', hide)
  node.addEventListener('focusin', showOnKeyboard)
  node.addEventListener('focusout', hide)

  return {
    update(newParam: TooltipParam) {
      label = typeof newParam === 'string' ? newParam : newParam.label
      always = typeof newParam === 'string' ? false : (newParam.always ?? false)
    },
    destroy() {
      node.removeEventListener('mouseenter', show)
      node.removeEventListener('mouseleave', hide)
      node.removeEventListener('click', hide)
      node.removeEventListener('focusin', showOnKeyboard)
      node.removeEventListener('focusout', hide)
      el?.remove()
    },
  }
}
