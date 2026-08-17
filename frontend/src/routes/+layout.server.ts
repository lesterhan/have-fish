import type { LayoutServerLoad } from './$types'

/**
 * Hands the root layout the session `hooks.server.ts` already resolved for this request.
 *
 * Without it the layout had to wait on the Better Auth client's own /api/auth/get-session
 * call before it could even start fetching sidebar data — a full round trip spent
 * re-answering a question the server had already answered for free.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
  return { session: locals.session }
}
