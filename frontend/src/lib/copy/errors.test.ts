/**
 * Keeps the two halves of an error in step.
 *
 * The backend names a failure and the frontend says what it means, and the two live in
 * different packages: `backend/src/errors.ts` holds `ERROR_STATUS`, `errors.ts` here holds
 * the words. Nothing imports across that line — the backend is not on the frontend's module
 * graph, and `lib-imports.test.ts` explains why a value import through `$lib` in a `.ts`
 * file is a trap besides. So this reads the registry's *source*, the way `copy.test.ts`
 * reads component sources and `tokens.test.ts` reads the stylesheet, and compares the two
 * key sets by name.
 *
 * Both directions matter. A code with no entry renders as its own name, which is how
 * `ACCOUNT_NOT_FOUND` ends up in front of a reader. An entry with no code is a sentence
 * nobody will ever see, left behind by a route that stopped failing that way — and it is
 * indistinguishable from a typo in a key that *is* live.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { errorsCopy, errorMessage } from './errors'

/** `backend/src/errors.ts`, from `frontend/src/lib/copy`. */
const REGISTRY = join(import.meta.dir, '..', '..', '..', '..', 'backend', 'src', 'errors.ts')

/**
 * The codes declared in `ERROR_STATUS`.
 *
 * Read from the object literal rather than the whole file so the `ErrorDetails` interface
 * below it — which names a subset of the same codes — cannot make a missing code look
 * present.
 */
export function codesIn(source: string): string[] {
  const start = source.indexOf('export const ERROR_STATUS = {')
  const end = source.indexOf('\n} as const', start)
  if (start === -1 || end === -1) return []
  return [...source.slice(start, end).matchAll(/^\s*([A-Z][A-Z0-9_]*): \d{3},$/gm)].map(
    (m) => m[1]!,
  )
}

const codes = codesIn(readFileSync(REGISTRY, 'utf8'))
const entries = Object.keys(errorsCopy)

describe('every backend error code has words', () => {
  it('found the registry at all', () => {
    // A moved file or a renamed export would otherwise make this suite pass by comparing
    // two empty lists.
    expect(codes.length).toBeGreaterThan(50)
  })

  it('leaves no code without an entry', () => {
    const missing = codes.filter((c) => !(c in errorsCopy))
    expect(
      missing,
      missing.length
        ? `These codes would render as themselves. Add a sentence to copy/errors.ts:\n  ${missing.join('\n  ')}`
        : '',
    ).toEqual([])
  })

  it('carries no entry without a code', () => {
    const stale = entries.filter((e) => !codes.includes(e))
    expect(
      stale,
      stale.length
        ? `No route can produce these any more — delete them:\n  ${stale.join('\n  ')}`
        : '',
    ).toEqual([])
  })
})

describe('errorMessage', () => {
  it('renders a plain code', () => {
    expect(errorMessage({ error: 'ACCOUNT_NOT_FOUND' }, 'x')).toBe(
      errorsCopy.ACCOUNT_NOT_FOUND,
    )
  })

  it('renders a code that takes detail', () => {
    expect(
      errorMessage({ error: 'FIELD_REQUIRED', detail: { field: 'paymentAccountId' } }, 'x'),
    ).toBe('payment account is required.')
  })

  it('names a field nobody has translated after its own key', () => {
    expect(errorMessage({ error: 'FIELD_REQUIRED', detail: { field: 'wobble' } }, 'x')).toBe(
      'wobble is required.',
    )
  })

  it('falls back on a body the API did not author', () => {
    expect(errorMessage(null, 'Failed to save settings')).toBe('Failed to save settings')
    expect(errorMessage('<html>502</html>', 'Failed to save settings')).toBe(
      'Failed to save settings',
    )
    expect(errorMessage({ status: 'ok' }, 'Failed to save settings')).toBe(
      'Failed to save settings',
    )
  })

  it('falls back on a code from a newer backend rather than printing it', () => {
    expect(errorMessage({ error: 'SOMETHING_NEW' }, 'Failed to save settings')).toBe(
      'Failed to save settings',
    )
  })

  it('survives a message that varies arriving with no detail', () => {
    // Version skew between the two halves, or a response nobody generated. Whatever comes
    // out must read as English and must not be a thrown TypeError from inside the code
    // whose whole job is rendering errors.
    for (const [code, entry] of Object.entries(errorsCopy)) {
      if (typeof entry !== 'function') continue
      let rendered = ''
      expect(() => {
        rendered = errorMessage({ error: code }, 'Something went wrong.')
      }, `${code} threw`).not.toThrow()
      expect(rendered, `${code} rendered as "${rendered}"`).not.toContain(code)
    }
  })
})

describe('the sentences themselves', () => {
  it('are whole sentences, not fragments', () => {
    const unfinished = Object.entries(errorsCopy)
      .filter(([, e]) => typeof e === 'string')
      .filter(([, e]) => !/[.!?]$/.test(e as string))
      .map(([code]) => code)
    expect(
      unfinished,
      unfinished.length
        ? `An error is a sentence and ends like one:\n  ${unfinished.join('\n  ')}`
        : '',
    ).toEqual([])
  })

  it('hold no currency symbol', () => {
    // Rule 3: a hardcoded symbol is a bug the first time the reader lands in Tokyo.
    const offenders = Object.entries(errorsCopy)
      .filter(([, e]) => typeof e === 'string' && /[$£€¥]/.test(e as string))
      .map(([code]) => code)
    expect(offenders).toEqual([])
  })
})
