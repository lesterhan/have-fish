/**
 * Keeps the web app from naming any host but its own (#491).
 *
 * The backend is held to the network by `backend/src/network.test.ts`: only the files listed
 * there may open a connection. The frontend had no equivalent, and a page load asked Google
 * for two stylesheets and the fonts behind them. Each request told Google an IP address and
 * that have-fish had been opened, and offline the local build fell back to system fonts, so it
 * looked different on a plane than at home.
 *
 * Everything the app loads now comes from the origin that served it. The invariant is
 * asserted against the source, not a browser: any absolute `http(s)://` URL, and any
 * protocol-relative `//host` in a place that loads something (`url()`, `@import`, `href`,
 * `src`), fails here unless it is on `ALLOWED`. That is broader than "stylesheets and
 * fonts" on purpose. A `fetch` to a remote API, an `<img>` from a CDN and an analytics
 * `<script>` all go the same way, and the frontend has no reason to name a remote host at
 * all today.
 *
 * Not counted: loopback, which is the app itself, and the XML namespaces an inline SVG
 * declares, which are identifiers that no browser fetches. Comments are stripped first,
 * because some of them name the URLs they replaced.
 */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { sourceFilesUnder, stripNoise } from './testing/source-scan'

const FRONTEND = join(import.meta.dir, '..')

/**
 * Files allowed to name a remote host, relative to `frontend/`, with the reason. Empty today.
 * A link the user clicks through to a page elsewhere would be a reason; anything the app
 * loads by itself is not.
 */
const ALLOWED: Array<{ file: string; why: string }> = []

/** Identifiers that look like URLs and are never requested. */
const NOT_A_REQUEST = [
  /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/,
  /^http:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink|1998\/Math\/MathML)$/,
]

const EXTENSIONS = ['.svelte', '.ts', '.js', '.css', '.html', '.svg', '.webmanifest', '.json']

function scanned(): string[] {
  return ['src', 'static']
    .flatMap((dir) => sourceFilesUnder(join(FRONTEND, dir), EXTENSIONS))
    .filter((file) => !file.endsWith('.test.ts'))
    .map((file) => relative(FRONTEND, file))
    .sort()
}

/** The remote references in one file's source, comments removed. */
export function remoteReferences(source: string): string[] {
  const code = stripNoise(source)
  const absolute = [...code.matchAll(/https?:\/\/[^\s"'`)<>]+/g)].map((m) => m[0])
  const protocolRelative = [
    ...code.matchAll(/(?:url\(\s*|@import\s+|(?:href|src)\s*=\s*)["'`]?(\/\/[^\s"'`)<>]+)/g),
  ].map((m) => m[1] as string)
  return [...absolute, ...protocolRelative].filter(
    (url) => !NOT_A_REQUEST.some((pattern) => pattern.test(url)),
  )
}

describe('the web app', () => {
  it('names no host but its own', () => {
    const allowed = new Set(ALLOWED.map((a) => a.file))
    const found = scanned()
      .filter((file) => !allowed.has(file))
      .flatMap((file) =>
        remoteReferences(readFileSync(join(FRONTEND, file), 'utf8')).map(
          (url) => `${file}: ${url}`,
        ),
      )
    expect(found).toEqual([])
  })

  it('scans the stylesheets, the page shell and the static files', () => {
    const files = scanned()
    for (const file of ['src/styles/base.css', 'src/app.html', 'static/favicon.svg']) {
      expect(files).toContain(file)
    }
  })

  it('has a reason for every file it lets through', () => {
    for (const { file, why } of ALLOWED) {
      expect(scanned()).toContain(file)
      expect(why.length).toBeGreaterThan(20)
    }
  })

  describe('would catch', () => {
    it.each([
      [
        'the Google Fonts import it replaced',
        "@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono');",
      ],
      ['a protocol-relative stylesheet', '<link rel="stylesheet" href="//cdn.example.net/a.css">'],
      ['a protocol-relative font', "src: url(//cdn.example.net/a.woff2) format('woff2');"],
      ['a script from a CDN', '<script src="https://cdn.example.net/analytics.js"></script>'],
      ['a fetch to a remote API', "await fetch('https://api.frankfurter.app/latest')"],
      ['an image from elsewhere', '<img src="http://example.net/a.png" alt="">'],
    ])('%s', (_, source) => {
      expect(remoteReferences(source)).toHaveLength(1)
    })
  })

  describe('lets through', () => {
    it.each([
      ['a package import', "@import '@fontsource-variable/jetbrains-mono/wght.css';"],
      ['a bundled font', "src: url(./files/a.woff2) format('woff2-variations');"],
      ['an SVG namespace', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
      ['the app on loopback', "const dev = 'http://127.0.0.1:8887/api'"],
      ['a URL in a comment', "/* was @import url('https://fonts.googleapis.com/css2') */"],
    ])('%s', (_, source) => {
      expect(remoteReferences(source)).toEqual([])
    })
  })
})
