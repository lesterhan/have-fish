export function scrollShadow(node: HTMLElement) {
  // Wrap node in a positioning context so shadows anchor to the viewport
  // of the scroll container, not to its scrollable content.
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'position:relative; overflow:hidden; flex:1; min-height:0; display:flex; flex-direction:column;'

  node.parentElement!.insertBefore(wrapper, node)
  wrapper.appendChild(node)

  // Node fills wrapper
  node.style.flex = '1'
  node.style.minHeight = '0'

  const top = document.createElement('div')
  const bottom = document.createElement('div')

  const sharedCss = `
    position: absolute;
    left: 0; right: 0;
    height: 20px;
    pointer-events: none;
    opacity: 0;
    z-index: 10;
  `
  top.style.cssText = sharedCss
  bottom.style.cssText = sharedCss

  top.style.top = '0'
  top.style.background = 'linear-gradient(to bottom, rgba(0,0,0,0.15), transparent)'
  bottom.style.bottom = '0'
  bottom.style.background = 'linear-gradient(to top, rgba(0,0,0,0.15), transparent)'

  wrapper.appendChild(top)
  wrapper.appendChild(bottom)

  function setShadow(el: HTMLElement, visible: boolean) {
    el.style.transition = visible
      ? 'opacity 80ms ease-in'
      : 'opacity 150ms ease-out'
    el.style.opacity = visible ? '1' : '0'
  }

  function update() {
    setShadow(top, node.scrollTop > 0)
    setShadow(bottom, node.scrollTop + node.clientHeight < node.scrollHeight - 1)
  }

  const ro = new ResizeObserver(update)
  ro.observe(node)

  const mo = new MutationObserver(update)
  mo.observe(node, { childList: true, subtree: true })

  node.addEventListener('scroll', update)
  update()

  return {
    destroy() {
      node.removeEventListener('scroll', update)
      ro.disconnect()
      mo.disconnect()
      // Unwrap: move node back to its original parent position
      wrapper.parentElement?.insertBefore(node, wrapper)
      wrapper.remove()
    },
  }
}
