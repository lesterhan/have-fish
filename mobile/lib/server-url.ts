/**
 * Server-address model for the login screen.
 *
 * Self-hosters re-type their server URL on every (re)login, which is slow and
 * error-prone. The login screen splits the address into a scheme toggle + host
 * field + port field, and remembers previously-used servers. The parse/compose
 * helpers here are RN-free so they can be unit-tested under `bun test`; all
 * SecureStore I/O lives in `lib/auth.ts`.
 */

export type Scheme = 'http' | 'https'

export interface ServerParts {
  scheme: Scheme
  host: string
  port: string
}

/** The app's standard backend port — prefilled on a fresh login screen. */
export const DEFAULT_PORT = '8887'

/** Cap on the remembered-server list (mirrors the currency recents cap). */
export const SERVERS_CAP = 8

/**
 * Best-effort parse of a possibly-partial server address into its parts.
 * Tolerant of bare hosts (`myserver`), host:port (`myserver:8887`), a full
 * URL (`https://myserver:8887`), and trailing slashes / paths. The scheme
 * defaults to `http` (the common case for a LAN / Tailscale home server);
 * the port is only filled when present — the UI supplies the default.
 */
export function parseServerUrl(raw: string): ServerParts {
  let rest = raw.trim()

  // Scheme prefix (default http when absent).
  let scheme: Scheme = 'http'
  const schemeMatch = rest.match(/^(https?):\/\//i)
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase() as Scheme
    rest = rest.slice(schemeMatch[0].length)
  }

  // Drop any path / query — only the authority matters.
  rest = rest.replace(/[/?#].*$/, '')

  // Split a trailing :port only when it is all digits; otherwise it's the host.
  let host = rest
  let port = ''
  const colon = rest.lastIndexOf(':')
  if (colon !== -1) {
    const maybePort = rest.slice(colon + 1)
    if (maybePort !== '' && /^\d+$/.test(maybePort)) {
      host = rest.slice(0, colon)
      port = maybePort
    }
  }

  return { scheme, host: host.trim(), port }
}

/**
 * Compose parts back into a canonical URL string (no trailing slash). Returns
 * an empty string when the host is blank so callers can guard. The port is
 * omitted when blank.
 */
export function composeServerUrl(parts: ServerParts): string {
  const host = parts.host.trim().replace(/\/+$/, '')
  if (!host) return ''
  const port = parts.port.trim()
  return `${parts.scheme}://${host}${port ? `:${port}` : ''}`
}

/** Round-trip a raw address through parse → compose for a canonical form. */
export function normalizeServerUrl(raw: string): string {
  return composeServerUrl(parseServerUrl(raw))
}

/**
 * Push a freshly-used server URL to the front of the remembered list, deduped
 * (by canonical form) and capped. Most-recent-first. Returns a new array.
 * Blank / unparseable URLs are ignored (the original list is returned).
 */
export function pushServer(list: readonly string[], url: string, cap = SERVERS_CAP): string[] {
  const canonical = normalizeServerUrl(url)
  if (!canonical) return [...list]
  const rest = list.filter((s) => normalizeServerUrl(s) !== canonical)
  return [canonical, ...rest].slice(0, cap)
}
