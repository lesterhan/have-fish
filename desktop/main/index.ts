// Main's entry: one instance, the ledger opened, the commands wired, then the window.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { CHANGED, COMMAND } from '../shared/channels'
import { runCommand } from './commands/run'
import { type Context, contextFor } from './context'
import { cannotOpen, failedToStart } from './copy'
import { type Ledger, openLedger } from './db/ledger'
import { readOrCreateInstallId } from './install-id'
import { appName, ledgerDir } from './paths'
import { APP_URL, CSP, contentTypeOf, fileFor, isAppUrl } from './protocol'
import { createWindow, denyPermissions } from './window'

/** Set by `electron-vite dev`: the renderer comes from Vite's dev server, with hot reload. */
const devServer = process.env.ELECTRON_RENDERER_URL
const log = { info: console.info, error: console.error }

// Before `ready`: `app://` behaves like https, so the page gets a real origin for 'self'.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

const name = appName(app.isPackaged)
// Before the lock, which is held per `userData` folder.
app.setPath('userData', join(app.getPath('appData'), name))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let window: BrowserWindow | undefined
  let ledger: Ledger | undefined

  // A second launch brings the first one forward instead.
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => ledger?.close())

  app.whenReady().then(() => {
    try {
      ledger = open()
    } catch (e) {
      log.error('opening the ledger threw', e)
      dialog.showErrorBox(failedToStart.title, failedToStart.message)
    }
    if (ledger === undefined) return app.quit()

    denyPermissions()
    serveRenderer(join(import.meta.dirname, '../renderer'))
    handleCommands(contextFor(ledger, announce))
    window = createWindow(join(import.meta.dirname, '../preload/index.cjs'), devServer ?? APP_URL)
  })
}

/** The ledger, or undefined once the person has been told why not. */
function open(): Ledger | undefined {
  const userData = app.getPath('userData')
  const opened = openLedger({
    dir: ledgerDir({
      env: process.env,
      platform: process.platform,
      home: app.getPath('home'),
      userData,
      name,
    }),
    installId: readOrCreateInstallId(userData),
    now: Date.now(),
  })
  if (opened.ok) return opened.value
  const { title, message } = cannotOpen(opened.failure)
  dialog.showErrorBox(title, message)
  return undefined
}

function serveRenderer(root: string): void {
  protocol.handle('app', async (request) => {
    const file = fileFor(root, request.url)
    if (file === null) return new Response('Not found', { status: 404 })
    try {
      const body = await readFile(file)
      return new Response(body, {
        headers: { 'content-type': contentTypeOf(file), 'content-security-policy': CSP },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function handleCommands(ctx: Context): void {
  ipcMain.handle(COMMAND, (event, name: unknown, input: unknown) => {
    // Only the app's own page; anything else that reached IPC gets nothing.
    if (!isAppUrl(event.senderFrame?.url ?? '', devServer)) {
      throw new Error('commands are for the app’s own window')
    }
    return runCommand(ctx, name, input, log)
  })
}

function announce(changed: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CHANGED, changed)
}
