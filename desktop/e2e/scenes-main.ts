// Opens the scenes in a window of their own, for the e2e suite: never through the app's window,
// which loads only its own page. The same scheme and CSP as the app, from scenes-out/. The scene
// is the SCENE variable; with none, the page links to each.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, protocol } from 'electron'
import { APP_URL, CSP, contentTypeOf, fileFor } from '../main/protocol.ts'

const root = join(import.meta.dirname, '..', 'scenes-out')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const file = fileFor(root, request.url)
    if (file === null) return new Response(null, { status: 404 })
    try {
      return new Response(await readFile(file), {
        headers: { 'content-type': contentTypeOf(file), 'content-security-policy': CSP },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  const scene = process.env.SCENE
  void window.loadURL(
    scene === undefined || scene === '' ? APP_URL : `${APP_URL}?scene=${scene}`,
  )
})
