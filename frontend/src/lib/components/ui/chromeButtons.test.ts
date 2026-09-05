/**
 * Every widget in the case does something real (DESIGN.md §2).
 *
 * The rule has one enforceable half: a chrome control that renders without a handler cannot
 * possibly do anything. That is how the minimize button survived for as long as it did — it
 * rendered, hovered and pressed exactly like the two beside it, so nothing about the running
 * app said it was inert, and nothing about the diff that added it did either.
 *
 * There is no component-rendering harness in this project — every other test here runs over
 * plain modules — so this reads the `.svelte` sources the way `tokens.test.ts` reads the token
 * file. That is weaker than mounting the component, and it is the assertion that would have
 * caught the actual bug, which is the trade being made.
 *
 * A `ChromeButton` may also be handed its handler by its caller through `{...restProps}`; the
 * test accepts that and checks the spread instead, because the component genuinely does
 * forward it.
 */

import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../../..', import.meta.url))

function svelteFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...svelteFilesUnder(full))
    else if (entry.endsWith('.svelte')) out.push(full)
  }
  return out
}

/** Every `<ChromeButton …>` opening tag in a source, whole. */
function chromeButtonTags(source: string): string[] {
  return [...source.matchAll(/<ChromeButton\b[^>]*>/g)].map((m) => m[0])
}

const USAGES = svelteFilesUnder(SRC)
  .map((file) => ({ file: file.slice(SRC.length), tags: chromeButtonTags(readFileSync(file, 'utf8')) }))
  .filter((entry) => entry.tags.length > 0)

describe('the case is honest', () => {
  it('finds the chrome buttons at all', () => {
    // A rename that makes the regex match nothing would otherwise turn this whole file green
    // and meaningless.
    expect(USAGES.flatMap((u) => u.tags).length).toBeGreaterThan(0)
  })

  for (const { file, tags } of USAGES) {
    for (const [index, tag] of tags.entries()) {
      it(`${file} chrome button ${index + 1} has a handler`, () => {
        const wired = /\bonclick=/.test(tag) || /\{\.\.\.\w/.test(tag)
        expect(wired).toBe(true)
      })
    }
  }
})

describe('the titlebar close button', () => {
  const LAYOUT = readFileSync(join(SRC, 'routes/+layout.svelte'), 'utf8')

  it('does not call window.close(), which browsers ignore for tabs a script did not open', () => {
    expect(LAYOUT).not.toContain('window.close()')
  })

  it('ends the session instead', () => {
    expect(LAYOUT).toContain("import { signOut, useSession } from '$lib/auth'")
    expect(LAYOUT).toContain('await signOut()')
  })

  it('leaves through the dialog rather than straight out of the titlebar', () => {
    // The confirm is the one place in the app where a dialog beats an undo (P4), because what
    // a misclick costs is whatever you were part-way through typing.
    expect(LAYOUT).toContain('<ConfirmDialog')
    expect(LAYOUT).toContain('confirmLabel="Sign out"')
  })

  it('carries no minimize control', () => {
    expect(LAYOUT).not.toContain('minimize')
  })
})
