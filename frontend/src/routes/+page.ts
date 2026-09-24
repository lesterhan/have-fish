import { redirect } from '@sveltejs/kit'
import { rootDestination } from '$lib/guards'
import { loadSession } from '$lib/session'
import type { PageLoad } from './$types'

// Accounts is the landing page now that the dashboard is gone: it is the one surface that
// answers "what do I have" without asking for a date range first.
//
// Runs in the browser rather than on the server. A failed session fetch lands on the
// sign-in form, which is the safe direction: it says what went wrong, an empty accounts
// page does not.
export const load: PageLoad = async () => {
  const user = await loadSession().catch(() => null)
  throw redirect(302, rootDestination(user))
}
