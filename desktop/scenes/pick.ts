// The bench's pick: which part drew an element, the tokens its part's rules name, and the lines
// the bench says of it. No DOM; `bench.ts` reads the frame and draws.

/** The property Svelte marks each element a part draws with, in dev only. */
export const SVELTE_META = '__svelte_meta'

/** Where a part drew an element: its file from desktop/, and the line in it. */
export type Part = { file: string; line: number }

/** The part Svelte's dev mark names: null with no mark, or one it can't read. */
export function partOf(meta: unknown): Part | null {
  if (typeof meta !== 'object' || meta === null || !('loc' in meta)) return null
  const { loc } = meta
  if (typeof loc !== 'object' || loc === null || !('file' in loc) || !('line' in loc)) return null
  const { file, line } = loc
  return typeof file === 'string' && typeof line === 'number' ? { file, line } : null
}

/** How many of an element's marks, from its own up, name its part's file: 1 with no mark. */
export function partRun(metas: readonly unknown[]): number {
  const file = partOf(metas[0])?.file
  if (file === undefined) return 1
  const differs = metas.findIndex((meta) => partOf(meta)?.file !== file)
  return differs === -1 ? metas.length : differs
}
