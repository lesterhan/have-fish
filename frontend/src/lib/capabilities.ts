import { once } from './once'

/**
 * Which build the page is talking to, and what it may show (#287). The backend answers this
 * before anyone signs in: `backend/src/build-app.ts`, `Capabilities`, which this mirrors.
 *
 * Fish Pie is absent from a local build that has never linked to its service (D3), so the
 * nav entry goes rather than sitting there disabled.
 */
export type Capabilities =
  | { mode: 'server'; fishPie: true }
  | { mode: 'local'; link: 'never'; fishPie: false }

/** What the page assumes when the backend cannot say: the hosted edition, as it always was. */
export const SERVER: Capabilities = { mode: 'server', fishPie: true }

export function isCapabilities(value: unknown): value is Capabilities {
  if (typeof value !== 'object' || value === null) return false
  const { mode, fishPie } = value as { mode?: unknown; fishPie?: unknown }
  return (mode === 'server' && fishPie === true) || (mode === 'local' && fishPie === false)
}

const load = once<Capabilities>(async () => {
  const res = await fetch('/api/capabilities')
  const body: unknown = res.ok ? await res.json() : null
  return isCapabilities(body) ? body : SERVER
})

/** Asked once per page load. A backend that cannot answer is treated as the server build. */
export function loadCapabilities(): Promise<Capabilities> {
  return load().catch(() => SERVER)
}

/**
 * The launch token in `/#token=…`, if the local launcher opened this page with one.
 * The fragment is never sent to the server, which is why the token rides there.
 */
export function launchTokenIn(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token')
  return token || null
}

/**
 * Trades the launch token for the session cookie, once, and takes it out of the address bar
 * either way: it is spent, and a spent token in a bookmark or the history is only confusing.
 * A token that fails leaves the page signed out, and the sign-in screen says what to do.
 */
export async function redeemLaunchToken(): Promise<void> {
  const token = launchTokenIn(window.location.hash)
  if (!token) return
  history.replaceState(history.state, '', window.location.pathname + window.location.search)
  if ((await loadCapabilities()).mode !== 'local') return
  await fetch('/api/local/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => undefined)
}
