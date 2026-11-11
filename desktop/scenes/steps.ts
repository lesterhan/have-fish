// Runs a scene's steps in the page: an action as the menu would send it, a key on whatever has
// the cursor, a click on the first element a selector finds, or text typed into the first field
// one finds. A step that finds nothing throws.

import type { Replay } from './bridge'
import type { Step } from './scenes'

/** Runs each step, then waits a frame so the next sees what it drew. */
export async function run(steps: readonly Step[], bridge: Replay): Promise<void> {
  for (const step of steps) {
    if ('action' in step) {
      bridge.act(step.action)
    } else if ('key' in step) {
      const target = document.activeElement ?? document.body
      target.dispatchEvent(new KeyboardEvent('keydown', { key: step.key, bubbles: true }))
    } else if ('fill' in step) {
      const found = document.querySelector(step.fill)
      if (!(found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement)) {
        throw new Error(`a fill found nothing it could type in: ${step.fill}`)
      }
      found.focus()
      found.value = step.text
      found.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      const found = document.querySelector(step.click)
      if (!(found instanceof HTMLElement)) {
        throw new Error(`a click found nothing it could click: ${step.click}`)
      }
      found.click()
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}
