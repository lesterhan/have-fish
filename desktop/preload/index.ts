// The only things the window can reach in main: run a command, hear what changed, and hear which
// action the menu chose. It runs sandboxed, so it imports nothing but Electron's IPC.

import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import { ACTION, CHANGED, COMMAND } from '../shared/channels'
import type { Bridge, Changed } from '../shared/commands'

const bridge: Bridge = {
  invoke: (name, input) => ipcRenderer.invoke(COMMAND, name, input),
  onChanged(listener) {
    const forward = (_: IpcRendererEvent, changed: Changed[]) => listener(changed)
    ipcRenderer.on(CHANGED, forward)
    return () => ipcRenderer.off(CHANGED, forward)
  },
  onAction(listener) {
    // An action's id and nothing else crosses.
    const forward = (_: IpcRendererEvent, id: unknown) => {
      if (typeof id === 'string') listener(id)
    }
    ipcRenderer.on(ACTION, forward)
    return () => ipcRenderer.off(ACTION, forward)
  },
}

contextBridge.exposeInMainWorld('haveFish', bridge)
