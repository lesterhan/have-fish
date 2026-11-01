// The only thing the window can reach in main: run a command, and hear what changed. It runs
// sandboxed, so it imports nothing but Electron's IPC.

import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import { CHANGED, COMMAND } from '../shared/channels'
import type { Bridge, Changed } from '../shared/commands'

const bridge: Bridge = {
  invoke: (name, input) => ipcRenderer.invoke(COMMAND, name, input),
  onChanged(listener) {
    const forward = (_: IpcRendererEvent, changed: Changed[]) => listener(changed)
    ipcRenderer.on(CHANGED, forward)
    return () => ipcRenderer.off(CHANGED, forward)
  },
}

contextBridge.exposeInMainWorld('haveFish', bridge)
