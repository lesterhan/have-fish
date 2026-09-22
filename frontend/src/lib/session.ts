import { authClient } from './auth'
import { once } from './once'

export type SessionUser = { id: string; email: string }

type GetSessionResponse = { data?: { user?: SessionUser } | null } | null | undefined

/** The user in a Better Auth get-session response, or null when there is no session. */
export function toUser(res: GetSessionResponse): SessionUser | null {
  return res?.data?.user ?? null
}

/**
 * The session, fetched at most once per page load.
 *
 * The route guards need it imperatively — a `load` has to decide whether to redirect
 * before the page renders — while the chrome in `+layout.svelte` needs it reactively,
 * which is what `useSession()` gives it. Those are two shapes over the same fact; this
 * owns the imperative one.
 */
const load = once<SessionUser | null>(async () => toUser(await authClient.getSession()))

export function loadSession(): Promise<SessionUser | null> {
  return load()
}

/** Drop the cache — after signing in or out, the answer has changed. */
export function forgetSession(): void {
  load.forget()
}
