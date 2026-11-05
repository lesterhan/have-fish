import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { APP_URL, CSP, contentTypeOf, devServerFor, fileFor, isAppUrl } from './protocol'

const root = '/opt/have-fish/out/renderer'

describe('fileFor', () => {
  test('the root is the page', () => {
    expect(fileFor(root, `${APP_URL}`)).toBe(join(root, 'index.html'))
    expect(fileFor(root, `${APP_URL}index.html`)).toBe(join(root, 'index.html'))
  })

  test('a file under the renderer folder', () => {
    expect(fileFor(root, `${APP_URL}assets/index-abc.js`)).toBe(join(root, 'assets/index-abc.js'))
    expect(fileFor(root, `${APP_URL}assets/a%20b.css`)).toBe(join(root, 'assets/a b.css'))
  })

  test('nothing outside it, however the path is spelled', () => {
    for (const path of [
      '../main/index.mjs',
      '%2e%2e/main/index.mjs',
      'assets/..%2f..%2fmain/index.mjs',
      '%2e%2e%2f%2e%2e%2fetc/passwd',
      '%E0%A4%A',
    ]) {
      const file = fileFor(root, `${APP_URL}${path}`)
      expect(file === null || file.startsWith(`${root}/`), path).toBe(true)
    }
    expect(fileFor(root, `${APP_URL}%2e%2e%2f%2e%2e%2fetc/passwd`)).toBeNull()
  })

  test('nothing from another host', () => {
    expect(fileFor(root, 'app://elsewhere/index.html')).toBeNull()
  })
})

describe('devServerFor', () => {
  const env = { ELECTRON_RENDERER_URL: 'http://localhost:5173' }

  test('a development run takes the dev server from the environment', () => {
    expect(devServerFor(false, env)).toBe('http://localhost:5173')
    expect(devServerFor(false, {})).toBeUndefined()
  })

  test('a packaged build has none, whatever the environment says', () => {
    expect(devServerFor(true, env)).toBeUndefined()
  })
})

describe('isAppUrl', () => {
  test('the app’s own pages, and nothing else', () => {
    expect(isAppUrl(`${APP_URL}index.html`)).toBe(true)
    expect(isAppUrl('app://elsewhere/index.html')).toBe(false)
    expect(isAppUrl('https://example.com/')).toBe(false)
    expect(isAppUrl('file:///opt/have-fish/out/renderer/index.html')).toBe(false)
  })

  test('the dev server, when one was given', () => {
    expect(isAppUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true)
    expect(isAppUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
    expect(isAppUrl('http://localhost:5173.evil.com/', 'http://localhost:5173')).toBe(false)
    expect(isAppUrl('http://localhost.evil.com:5173/', 'http://localhost:5173')).toBe(false)
    expect(isAppUrl('', 'http://localhost:5173')).toBe(false)
  })
})

test('the policy loads nothing from anywhere but the app', () => {
  expect(CSP).toMatch(/^default-src 'self'/)
  expect(CSP).not.toMatch(/unsafe|http|\*/)
})

test('content types', () => {
  expect(contentTypeOf('index.html')).toBe('text/html; charset=utf-8')
  expect(contentTypeOf('assets/a.js')).toBe('text/javascript; charset=utf-8')
  expect(contentTypeOf('assets/a.css')).toBe('text/css; charset=utf-8')
  expect(contentTypeOf('assets/a.bin')).toBe('application/octet-stream')
})
