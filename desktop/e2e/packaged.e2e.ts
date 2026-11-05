// What only a packaged build can show: the shipped app loads its own pages and nothing else.

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, onTestFinished, test } from 'vitest'
import { aHome, launch } from './app'

/** A page on this machine, standing in for anything that isn't the app. */
async function anotherPage(): Promise<string> {
  const server = createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>Not the app</title><input name="amount">')
  })
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
}

describe.runIf(process.env.E2E_APP)('a packaged build', () => {
  test('loads only its own pages, whatever the dev server variable says', async () => {
    const { page } = await launch(aHome(), { ELECTRON_RENDERER_URL: await anotherPage() })

    expect(page.url()).toMatch(/^app:\/\/have-fish\//)
    expect(await page.title()).not.toBe('Not the app')
  })
})
