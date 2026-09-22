import { redirect } from '@sveltejs/kit'
import { HOME } from '$lib/routes'
import { loadSession } from '$lib/session'
import type { PageLoad } from './$types'

// Accounts is the landing page now that the dashboard is gone: it is the one surface that
// answers "what do I have" without asking for a date range first.
//
// Runs in the browser rather than on the server. A failed session fetch lands on /login,
// which is the safe direction: the sign-in form tells you what went wrong, an empty
// accounts page does not.
export const load: PageLoad = async () => {
  const user = await loadSession().catch(() => null)
  throw redirect(302, user ? HOME : '/login')
}
