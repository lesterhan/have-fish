import { redirect } from '@sveltejs/kit'
import { SIGN_IN } from '$lib/guards'
import type { PageLoad } from './$types'

// The local build has no accounts to create; its sign-in screen says how a window gets in.
export const load: PageLoad = async ({ parent }) => {
  const { capabilities } = await parent()
  if (capabilities.mode === 'local') throw redirect(302, SIGN_IN)
}
