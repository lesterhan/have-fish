// Where the app keeps the ledger. Not the current app's folder (`havefish`): until the rewrite
// replaces it, neither app can open the other's file.

import { join } from 'node:path'

/** A development run keeps folders of its own, so trying a change never touches the real ledger. */
export const appName = (packaged: boolean) => (packaged ? 'have-fish' : 'have-fish-dev')

type Where = {
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  home: string
  /** Electron's `userData`: the app's settings, and `install-id`. */
  userData: string
  name: string
}

/**
 * On Linux, `$XDG_DATA_HOME/<name>`, which the spec says falls back to `~/.local/share` and
 * ignores when relative. Elsewhere, `ledger/` beside the app's settings. Never the settings folder
 * itself: copying the ledger's folder must not copy `install-id`.
 */
export function ledgerDir({ env, platform, home, userData, name }: Where): string {
  if (platform !== 'linux') return join(userData, 'ledger')
  const xdg = env.XDG_DATA_HOME
  return join(xdg?.startsWith('/') ? xdg : join(home, '.local', 'share'), name)
}
