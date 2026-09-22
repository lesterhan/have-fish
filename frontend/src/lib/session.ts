import { authClient } from './auth'

export type SessionUser = { id: string; email: string }

/**
 * The session, fetched at most once per page load.
 *
 * The route guards need the session imperatively — a `load` has to decide whether to
 * redirect before the page renders — while the chrome in `+layout.svelte` needs it
 * reactively, which is what `useSession()` gives it. Those are different shapes over the
 * same fact, so this owns the imperative half and caches it.
 *
 * A rejected fetch is deliberately not cached. Otherwise one blip while the backend is
 * restarting would mean every subsequent guard on that page load reuses the failure and
 * bounces the user to `/login` with a perfectly good cookie.
 */
let inFlight: Promise<SessionUser | null> | null = null

export function loadSession(): Promise<SessionUser | null> {
  if (!inFlight) {
    inFlight = authClient
      .getSession()
      .then((res) => (res.data?.user as SessionUser | undefined) ?? null)
      .catch((err) => {
        inFlight = null
        throw err
      })
  }
  return inFlight
}

/** Drop the cache — after signing in or out, the answer has changed. */
export function forgetSession(): void {
  inFlight = null
}
