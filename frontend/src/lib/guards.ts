import { HOME } from './routes'
import type { SessionUser } from './session'

/** Where a signed-out visitor is sent, and where a failed session check lands. */
export const SIGN_IN = '/login'

/**
 * Where a visitor at `/` belongs.
 *
 * A named function rather than a conditional inlined in `+page.ts`, so the policy can be
 * tested without standing up a router or patching the module system.
 */
export function rootDestination(user: SessionUser | null): string {
  return user ? HOME : SIGN_IN
}
