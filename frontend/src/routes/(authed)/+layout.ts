import { redirect } from '@sveltejs/kit'
import { SIGN_IN } from '$lib/guards'
import { loadSession } from '$lib/session'
import type { LayoutLoad } from './$types'

// The gate for every authenticated route. Runs once on entry to the group and again only
// when invalidated, so navigating between authed pages costs no auth request.
//
// The backend is the real authority: every /api/* route rejects a request without a valid
// session regardless of what happens here (`backend/src/app.ts`). This redirect exists so
// a signed-out visitor sees the sign-in form instead of a page of failed fetches.
export const load: LayoutLoad = async () => {
  const user = await loadSession().catch(() => null)
  if (!user) throw redirect(302, SIGN_IN)
  return { user }
}
