/**
 * The page shell names only files the app has (#307).
 *
 * `app.html` asked for `favicon.png`, which never existed, so every page load cost a 404 and
 * the tab icon came from a second `<link>` the root layout added once it had hydrated. The
 * shell now names the SVG itself, and this test holds every asset it names to `static/`.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FRONTEND = join(import.meta.dir, '..')
const SHELL = readFileSync(join(FRONTEND, 'src/app.html'), 'utf8')

describe('app.html', () => {
  const assets = [...SHELL.matchAll(/%sveltekit\.assets%\/([^"']+)/g)].map((m) => m[1] as string)

  it('names the icon, as the SVG it is', () => {
    expect(assets).toContain('favicon.svg')
    const link = SHELL.match(/<link[^>]*favicon\.svg[^>]*>/)?.[0] ?? ''
    expect(link).toContain('rel="icon"')
    expect(link).toContain('type="image/svg+xml"')
  })

  it.each(assets)('%s is in static/', (asset) => {
    expect(existsSync(join(FRONTEND, 'static', asset))).toBe(true)
  })
})
