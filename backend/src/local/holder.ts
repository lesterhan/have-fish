// Asking the instance a lockfile names whether it is still there (#516). Only ever 127.0.0.1,
// and only the port that instance wrote into the lockfile itself.
//
// The question is the same one a browser tab asks: here is a launch token signed with the key
// in the lockfile, trade it for a session. Only a live instance holding that key answers 204,
// so the answer says both that something is listening and that it is this app, rather than
// whatever else took the port after a crash. A pid cannot say either: see `lockfile.ts`.

import { mintLaunchToken } from './launch-token'
import type { Holder } from './lockfile'

/** Plenty for an idle instance; a dead port refuses at once rather than timing out. */
export const ANSWER_TIMEOUT_MS = 2000
/** For an instance whose pid is alive: time to get through, say, a large import first. */
export const PATIENT_TIMEOUT_MS = 8000

/** Whether an instance holding `holder.launchKey` answers on `holder.port`. */
export async function holderAnswers(
  holder: Pick<Holder, 'port' | 'launchKey'>,
  timeoutMs = ANSWER_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${holder.port}/api/local/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: mintLaunchToken(holder.launchKey) }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.status === 204
  } catch {
    // Refused, reset or timed out: nothing that holds the key is there.
    return false
  }
}
