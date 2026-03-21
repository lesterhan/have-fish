import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.session) {
    throw redirect(302, '/transactions')
  }
  throw redirect(302, '/login')
}
