/**
 * Turning the API's failure codes into something a person can read.
 *
 * The backend answers a failed request with a code rather than a sentence —
 * `{ error: 'ACCOUNT_NOT_FOUND' }` — and each client owns the words. The web app has the
 * real catalog in `frontend/src/lib/copy/errors.ts`; mobile's copy extraction is its own
 * story, and duplicating eighty-seven sentences here now would mean editing both for the
 * rest of the epic and drifting anyway.
 *
 * So this is a placeholder with one job: never show a reader `ACCOUNT_NOT_FOUND`. It
 * unshouts the code into a plain sentence — machine-flavoured, but readable, and honest
 * about which failure happened, which is more than the caller's generic fallback carries.
 * The story that extracts mobile's copy replaces this with the shared catalog.
 */

/** What the API sends when a request fails. Anything else is a failure it did not author. */
function codeIn(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const code = (body as { error?: unknown }).error
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : null
}

/**
 * The sentence for one failed response body.
 *
 * `fallback` covers the failures the API did not author — a server that is not there, a
 * proxy, an HTML error page — and anything that does not look like a code, so a backend
 * still sending prose keeps working.
 */
export function errorMessage(body: unknown, fallback: string): string {
  const code = codeIn(body)
  if (code === null) {
    const prose = (body as { error?: unknown } | null)?.error
    return typeof prose === 'string' && prose !== '' ? prose : fallback
  }
  const words = code.toLowerCase().replace(/_/g, ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`
}
