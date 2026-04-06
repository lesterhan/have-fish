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
    if (!always && !node.closest('.sidebar')?.classList.contains('collapsed')) return

    el = document.createElement('div')
    el.className = 'hf-tooltip'
    el.textContent = label
    document.body.appendChild(el)

    const rect = node.getBoundingClientRect()
    // offsetHeight forces layout so dimensions are available immediately
    el.style.top = `${rect.top + (rect.height - el.offsetHeight) / 2}px`
    el.style.left = `${rect.right + 8}px`
  }

  function hide() {
    el?.remove()
    el = null
  }

  node.addEventListener('mouseenter', show)
  node.addEventListener('mouseleave', hide)
  node.addEventListener('click', hide)

  return {
    update(newParam: TooltipParam) {
      label = typeof newParam === 'string' ? newParam : newParam.label
      always = typeof newParam === 'string' ? false : (newParam.always ?? false)
    },
    destroy() {
      node.removeEventListener('mouseenter', show)
      node.removeEventListener('mouseleave', hide)
      node.removeEventListener('click', hide)
      el?.remove()
    },
  }
}
