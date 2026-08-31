import { redirect } from '@sveltejs/kit'
import { HOME } from '$lib/routes'
import type { PageServerLoad } from './$types'

// Accounts is the landing page now that the dashboard is gone: it is the one surface that
// answers "what do I have" without asking for a date range first.
export const load: PageServerLoad = async ({ locals }) => {
  if (locals.session) {
    throw redirect(302, HOME)
  }
  throw redirect(302, '/login')
}
