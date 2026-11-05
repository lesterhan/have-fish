// The one window, locked down: no Node in the page, a sandboxed preload, and no way to
// navigate away or open another window.

import { BrowserWindow, session } from 'electron'
import { copy } from '../copy'

/** `background` is the theme's, so the window never flashes white before the page paints. */
export function createWindow(preload: string, url: string, background: string): BrowserWindow {
  const window = new BrowserWindow({
    backgroundColor: background,
    width: 960,
    height: 720,
    minWidth: 360,
    minHeight: 400,
    title: copy.app.name,
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  window.once('ready-to-show', () => window.show())

  const contents = window.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-redirect', (event) => event.preventDefault())
  contents.on('will-attach-webview', (event) => event.preventDefault())

  void window.loadURL(url)
  return window
}

/** No camera, no notifications, nothing: the page never needs to ask. */
export function denyPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, answer) =>
    answer(false),
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
}
