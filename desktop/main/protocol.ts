// The window's pages come from `app://have-fish/`, served from the built renderer folder and
// nowhere else, under a policy that loads nothing from outside the app.

import { extname, join, sep } from 'node:path'

export const APP_HOST = 'have-fish'
export const APP_URL = `app://${APP_HOST}/`

export const CSP = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** The file a request names, or null for anything outside `root`. */
export function fileFor(root: string, url: string): string | null {
  const { host, pathname } = new URL(url)
  if (host !== APP_HOST) return null
  let path: string
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const file = join(root, path === '/' ? 'index.html' : path)
  return file.startsWith(root + sep) ? file : null
}

/** A page of this app: `app://have-fish/`, or the dev server in a development run. */
export function isAppUrl(url: string, devServer?: string): boolean {
  if (url.startsWith(APP_URL)) return true
  if (devServer === undefined || !URL.canParse(url)) return false
  return new URL(url).origin === new URL(devServer).origin
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

export const contentTypeOf = (file: string) =>
  TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
