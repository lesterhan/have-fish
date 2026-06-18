/**
 * Bundled font assets for the Pocket Companion design.
 *
 * Matches the web (`frontend/src/styles/base.css`) plus the design's numpad
 * weight:
 * - **Source Serif 4 600** — group name (23/600), bottom-sheet titles (19/600).
 * - **JetBrains Mono 400/500/600/700** — all numerals, labels, currency codes,
 *   balances, tags, and the numpad digits (22/600).
 *
 * Android does not synthesize weights from a single custom family, so each
 * weight ships as its own family. The keys here are the `fontFamily` strings
 * used everywhere — they are mirrored in `theme.font`.
 *
 * Spread `fontAssets` into Expo's `useFonts` and gate the app render on the
 * returned `loaded` flag (see `app/_layout.tsx`).
 */
export const fontAssets = {
  'SourceSerif4-SemiBold': require('../assets/fonts/SourceSerif4-SemiBold.ttf'),
  'JetBrainsMono-Regular': require('../assets/fonts/JetBrainsMono-Regular.ttf'),
  'JetBrainsMono-Medium': require('../assets/fonts/JetBrainsMono-Medium.ttf'),
  'JetBrainsMono-SemiBold': require('../assets/fonts/JetBrainsMono-SemiBold.ttf'),
  'JetBrainsMono-Bold': require('../assets/fonts/JetBrainsMono-Bold.ttf'),
} as const
