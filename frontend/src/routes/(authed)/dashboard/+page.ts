import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/**
 * The dashboard is gone — shipped, then unused. Its two useful halves live elsewhere:
 * spending trends on the Spending page, what needs catching up in the Accounts page's
 * attention chip.
 *
 * A redirect rather than a 404 because this was the app's home for its whole life — `/`
 * pointed here until now, so a bookmark of "the app" is quite likely this exact path.
 */
export const load: PageLoad = () => {
  redirect(308, '/accounts')
}
