// Opens the parts sheet in a window of its own, for the capture script: never through the app's
// window, which loads only its own page. The same scheme and CSP as the app, from sheet-out/.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, protocol } from 'electron'
import { APP_URL, CSP, contentTypeOf, fileFor } from '../main/protocol.ts'

const root = join(import.meta.dirname, '..', 'sheet-out')

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
  void window.loadURL(APP_URL)
})
