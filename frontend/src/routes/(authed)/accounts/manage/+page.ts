import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/**
 * The manage page's tree, rename cascade and transaction preview all live on the Accounts
 * page now — the tree and rename on the Categories tab, the preview as the row drawer.
 *
 * The route stays as a redirect rather than a 404: this was a bookmarkable page, and it was
 * linked from Settings for long enough to be muscle memory. A universal load rather than a
 * server one, so an in-app link resolves on the client instead of taking a round trip.
 */
export const load: PageLoad = () => {
  redirect(308, '/accounts?tab=categories')
}
