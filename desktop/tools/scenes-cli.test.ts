// The impure half's own tests: the server a shot loads from, and what a launch says when it
// finds no browser. Neither needs a browser to run.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { launch, serve } from './scenes-cli'

describe('serve', () => {
  test('answers a missing file 404 and goes on serving', async () => {
    const root = mkdtempSync(join(tmpdir(), 'have-fish-serve-'))
    writeFileSync(join(root, 'index.html'), '<p>a page</p>')
    const server = await serve(root)
    try {
      // A browser asks for this on every page, and a 200 already sent would end the server.
      expect((await fetch(`${server.url}/favicon.ico`)).status).toBe(404)
      const page = await fetch(`${server.url}/`)
      expect(page.status).toBe(200)
      expect(await page.text()).toBe('<p>a page</p>')
    } finally {
      await server.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('launch', () => {
  test('with no browser it can find, says which it tried and answers null', async () => {
    const said: string[] = []
    const error = console.error
    console.error = (...lines: unknown[]) => said.push(lines.map(String).join(' '))
    try {
      const found = await launch([
        { name: 'Nowhere', options: { executablePath: '/no/such/browser' } },
      ])
      expect(found).toBeNull()
    } finally {
      console.error = error
    }
    expect(said.join('\n')).toContain('Nowhere')
  })
})
