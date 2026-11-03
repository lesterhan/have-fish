// What this machine remembers that isn't the ledger's. It lives in the settings folder, beside
// `install-id`, so a copied ledger never carries it and another machine remembers its own.

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const SETTINGS_FILE = 'settings.json'

export type Machine = {
  /** The account the last spend written here came out of, if there was one. */
  lastFrom(): string | null
  usedFrom(accountId: string): void
}

/** For tests, and for a run that can't keep a file: remembered until the app quits. */
export function forgetful(): Machine {
  let last: string | null = null
  return {
    lastFrom: () => last,
    usedFrom: (id) => {
      last = id
    },
  }
}

// Loose, so a key a newer version wrote is kept when this one writes the file back.
const Saved = z.looseObject({ lastFrom: z.uuid().optional().catch(undefined) })
type Saved = z.infer<typeof Saved>

/** `configDir/settings.json`. A file that can't be read is treated as empty, never as fatal. */
export function settingsIn(configDir: string): Machine {
  const path = join(configDir, SETTINGS_FILE)
  let saved = read(path)
  return {
    lastFrom: () => saved.lastFrom ?? null,
    usedFrom(id) {
      if (saved.lastFrom === id) return
      saved = { ...saved, lastFrom: id }
      try {
        write(configDir, path, saved)
      } catch {
        // The spend is already saved; a file that can't be written only costs the memory of it.
      }
    },
  }
}

function read(path: string): Saved {
  try {
    const parsed = Saved.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

/** Written beside, then renamed over, so a crash leaves the old file or the new one. */
function write(configDir: string, path: string, saved: Saved): void {
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  const next = `${path}.next`
  writeFileSync(next, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 })
  chmodSync(next, 0o600)
  renameSync(next, path)
}
