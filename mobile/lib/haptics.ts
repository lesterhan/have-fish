import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { HAPTICS_ENABLED_KEY, parseHapticsEnabled } from './haptics-prefs'

/**
 * Haptics gate — a thin wrapper over expo-haptics that every tactile cue in the
 * app routes through, so a single Settings toggle can turn vibration off.
 *
 * The enabled flag is cached in a module variable (default on) so the fire-and-
 * forget cues stay synchronous — no per-keypress AsyncStorage read. Call
 * {@link loadHapticsEnabled} once at startup to hydrate it; the Settings toggle
 * updates both the cache and storage via {@link setHapticsEnabled}.
 *
 * The pure preference helpers ({@link HAPTICS_ENABLED_KEY},
 * {@link parseHapticsEnabled}) live in `haptics-prefs.ts` and are re-exported
 * here so callers have a single import surface.
 */

export { HAPTICS_ENABLED_KEY, parseHapticsEnabled }

let enabled = true

/** Hydrate the cached flag from storage. Call once on app start. */
export async function loadHapticsEnabled(): Promise<boolean> {
  try {
    enabled = parseHapticsEnabled(await AsyncStorage.getItem(HAPTICS_ENABLED_KEY))
  } catch {
    enabled = true
  }
  return enabled
}

/** Current cached value (for the Settings toggle's initial state). */
export function isHapticsEnabled(): boolean {
  return enabled
}

/** Flip the setting: update the cache and persist. */
export async function setHapticsEnabled(value: boolean): Promise<void> {
  enabled = value
  try {
    await AsyncStorage.setItem(HAPTICS_ENABLED_KEY, value ? 'true' : 'false')
  } catch {
    // Non-fatal: the in-memory flag is already updated for this session.
  }
}

/** Lightest tick — key presses, chips, tiles, buttons. */
export function selection(): void {
  if (!enabled) return
  Haptics.selectionAsync().catch(() => {})
}

/** Longer warning pattern — destructive cues (e.g. clear amount). */
export function warning(): void {
  if (!enabled) return
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
}

/** Success notification — completed actions (e.g. expense added). */
export function success(): void {
  if (!enabled) return
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
}
