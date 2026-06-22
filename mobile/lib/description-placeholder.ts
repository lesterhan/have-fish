/**
 * Playful placeholders for the Add screen's free-text Description field — the one
 * spot on the form with no fixed answer, so it gets a bit of personality. Picked
 * once per screen mount via {@link randomPlaceholder}. Purely cosmetic: an empty
 * description still saves as `DEFAULT_DESCRIPTION`, never the placeholder text.
 */
export const DESCRIPTION_PLACEHOLDERS = [
  '吃啥了？',
  'Itemize the snack',
  '买了啥？',
  'Nice treat?',
  '花哪了？',
  'State your business',
  '记一笔',
  'Nature of the spend',
  'what eat',
  'Tofu and/or cheese?',
  '这顿多少？',
  'Log the damage',
  '买单',
  'Coffee, presumably',
  'Je demande l\'addition',
  'T’as mangé quoi?',
  'C’tait combien?',
  'Encore un café?',
  'Encore un p\'tit croissant?',
  'Note ça là',
] as const

/** Pick a random placeholder. Pass a seed `rng` (0–1) for deterministic tests. */
export function randomPlaceholder(rng: number = Math.random()): string {
  const i = Math.floor(rng * DESCRIPTION_PLACEHOLDERS.length)
  // Clamp guards rng === 1 (Math.random never returns 1, but a test seed might).
  return DESCRIPTION_PLACEHOLDERS[Math.min(i, DESCRIPTION_PLACEHOLDERS.length - 1)]
}
