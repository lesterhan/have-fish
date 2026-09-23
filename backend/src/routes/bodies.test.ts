/**
 * Keeps request bodies out of the trust-by-assertion business.
 *
 * `c.req.json<T>()` reads as validation and performs none: it is a cast over a value
 * nothing has looked at. The bare `await c.req.json()` some routes used instead is honest
 * about being `any`, but a handler that destructures it is no safer. Both were replaced by
 * a schema; this is what stops one coming back.
 *
 * The rule is written against `c.req.json` itself rather than against the type-argument
 * spelling. The original acceptance criterion named only `c.req.json<T>()`, and #380 moves
 * every one of those out of this repository — which would have satisfied the criterion by
 * deletion while leaving the routes that stay exactly as unchecked as they were.
 *
 * Modelled on `errors.test.ts`, which reads the source of every route for the same reason.
 */

import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROUTES = import.meta.dir
const SELF = 'bodies.test.ts'

/**
 * The routes that leave this repository under #380 and #381.
 *
 * Their bodies are read with `c.req.json<T>()` and should be ported to schemas in their new
 * home rather than here and then again there. Deleting a name from this list is how a moved
 * route rejoins the rule; the test fails if a name here no longer matches a file, so the
 * list cannot outlive the move.
 */
const LEAVING_UNDER_FISH_PIE_SPLIT = [
  'fish-pie-balances.ts',
  'fish-pie-categories.ts',
  'fish-pie-expenses.ts',
  'fish-pie-groups.ts',
  'fish-pie-invites.ts',
  'fish-pie-merge.ts',
  'fish-pie-overview.ts',
  'fish-pie-settlements.ts',
]

function routeFiles(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(ROUTES)) {
    const full = join(ROUTES, entry)
    if (statSync(full).isDirectory()) continue
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out.sort()
}

describe('every route that stays reads its body through a schema', () => {
  it('has no `c.req.json` left in it', () => {
    const offenders = routeFiles()
      .filter((f) => !LEAVING_UNDER_FISH_PIE_SPLIT.includes(f.slice(f.lastIndexOf('/') + 1)))
      .filter((f) => readFileSync(f, 'utf8').includes('c.req.json'))
      .map((f) => relative(ROUTES, f))

    expect(offenders).toEqual([])
  })

  it('reaches every one of them, so the rule is not vacuous', () => {
    const checked = routeFiles()
      .map((f) => f.slice(f.lastIndexOf('/') + 1))
      .filter((f) => !LEAVING_UNDER_FISH_PIE_SPLIT.includes(f) && f !== SELF)

    // The eight named in #387, plus anything added since — a new route file is covered the
    // day it lands rather than the day someone remembers to list it.
    expect(checked).toEqual(
      expect.arrayContaining([
        'accounts.ts',
        'coverage.ts',
        'import.ts',
        'parsers.ts',
        'postings.ts',
        'rules.ts',
        'transactions.ts',
        'user-settings.ts',
      ]),
    )
  })

  it('names only routes that still exist, so the exemption list cannot outlive the move', () => {
    const present = new Set(routeFiles().map((f) => f.slice(f.lastIndexOf('/') + 1)))
    const stale = LEAVING_UNDER_FISH_PIE_SPLIT.filter((f) => !present.has(f))

    expect(stale).toEqual([])
  })

  it('parses through this repository’s own helper rather than a bare safeParse', () => {
    // `parseBody` is what maps a schema failure onto an error code and answers a body that
    // is not JSON at all. A route calling `schema.safeParse` directly would validate and
    // then have to reinvent both.
    const bare = routeFiles()
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
        return src.includes('.safeParse(') && !src.includes('parseBody')
      })
      .map((f) => relative(ROUTES, f))

    expect(bare).toEqual([])
  })
})
