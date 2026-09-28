// The single-use link a local build opens the browser with (#287, L07 §1).
//
// Any web page can send requests to 127.0.0.1, so the local server needs a session that a
// page it did not open cannot have. The launcher opens `/#token=<token>`; the page trades
// the token for a cookie once, and the token is spent. It rides in the fragment so it is
// never sent in a request line, a log or a Referer.
//
// A token is `<issued ms>.<nonce>.<mac>`, signed with the launch key the running instance
// wrote to its lockfile. That is what lets a second launch mint a link for the instance
// already running without asking it over the network: it reads the key, as only the same
// OS user can, and signs one.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** How long a link opens the app for. Long enough for a slow browser to start, no longer. */
export const LAUNCH_TOKEN_TTL_MS = 2 * 60 * 1000

/** A fresh random secret: a launch key or a session cookie value. */
export function randomSecret(): string {
  return randomBytes(32).toString('base64url')
}

function mac(key: string, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

export function mintLaunchToken(key: string, now = Date.now()): string {
  const payload = `${now}.${randomBytes(16).toString('base64url')}`
  return `${payload}.${mac(key, payload)}`
}

/** Constant-time string equality, so a wrong guess learns nothing from how long it took. */
export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The server's side: accepts each well-signed, unexpired token once. Spent nonces are
 * remembered only until they would have expired anyway.
 */
export function launchTokenRedeemer(key: string) {
  const spent = new Map<string, number>()

  return function redeem(token: string, now = Date.now()): boolean {
    for (const [nonce, issued] of spent) {
      if (now - issued > LAUNCH_TOKEN_TTL_MS) spent.delete(nonce)
    }

    const [issuedText, nonce, signature, ...rest] = token.split('.')
    if (!issuedText || !nonce || !signature || rest.length > 0) return false
    if (!sameSecret(signature, mac(key, `${issuedText}.${nonce}`))) return false

    const issued = Number(issuedText)
    // A little allowance for a clock that steps between minting and redeeming.
    if (
      !Number.isSafeInteger(issued) ||
      now - issued > LAUNCH_TOKEN_TTL_MS ||
      issued - now > 5000
    ) {
      return false
    }
    if (spent.has(nonce)) return false
    spent.set(nonce, issued)
    return true
  }
}
