/**
 * Pure haptics-preference helpers — kept free of any React Native / expo import
 * so they can be unit-tested under `bun test` (the RN modules don't parse there).
 * The stateful gate that actually fires vibration lives in `lib/haptics.ts`.
 */

export const HAPTICS_ENABLED_KEY = 'havefish_haptics_enabled'

/** Parse the stored flag; absent/unknown values default to enabled. */
export function parseHapticsEnabled(raw: string | null): boolean {
  return raw !== 'false'
}
