/**
 * Where the app sends you when you have not asked for anywhere in particular.
 *
 * A constant because two places decide it — the root load and the sign-in form — and they
 * had already drifted once: `/` pointed at the dashboard while signing in went to
 * `/spending`, so the home page depended on how you arrived.
 */
export const HOME = '/accounts'
