/**
 * Every user-facing string in the app, as prose you can read in one place.
 *
 * Import the namespace, not the leaves — `copy.auth.signIn.title`, never
 * `import { signIn } from '$lib/copy/auth'`. The dotted path is what makes a string
 * greppable back to its screen, and what makes `svelte-check` shout when a key is
 * renamed out from under a component.
 *
 * The rules, in full:
 *
 * 1. **A message owns its whole sentence.** Never assemble prose at the call site from
 *    two copy keys and a conditional. If a count changes the wording, that is what
 *    `plural` is for; if a link sits mid-sentence, restructure the sentence.
 * 2. **Parameters are named and typed.** A message that varies is a function, so a
 *    renamed or missing argument is a build error rather than `undefined` on screen.
 * 3. **Formatted data is not copy.** Amounts, dates and percentages go through the
 *    existing `money`/`date` helpers and `Intl`. A currency symbol in a copy file is a
 *    bug the first time the user lands in Tokyo.
 * 4. **One file per surface**, added by the story that converts that surface.
 *    `copy.test.ts` then holds that surface to it.
 *
 * There is deliberately no i18n library here, and no `en/` folder implying a sibling.
 * This is a typed object; that is the whole design. If a second locale ever arrives,
 * well-shaped input like this is a scripted transform away from a real message catalog.
 */
import { authCopy } from './auth'

export const copy = {
  auth: authCopy,
} as const

export { plural } from './plural'
