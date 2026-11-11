// Runs a scene's steps in the page: an action as the menu would send it, a key on whatever has
// the cursor, a click on the first element a selector finds. A step that finds nothing throws.

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
    } else {
      const found = document.querySelector(step.click)
      if (found === null) throw new Error(`a click found nothing: ${step.click}`)
      if (found instanceof HTMLElement) found.click()
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}
