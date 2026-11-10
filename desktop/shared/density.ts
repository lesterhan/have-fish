// How tightly the ledger is set: the row height, the day's band and the base type size, and
// nothing else. The names live here; main, the menu, the palette and the window read them here.

/** Tightest first, so the menu reads as a ladder. */
export const DENSITIES = ['compact', 'regular', 'comfortable', 'large'] as const
export type Density = (typeof DENSITIES)[number]

/** A saved value read back: anything this version doesn't know is Regular. */
export function densityOf(saved: unknown): Density {
  return DENSITIES.find((d) => d === saved) ?? 'regular'
}
