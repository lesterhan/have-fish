// Which spend the list has selected, as the list changes and the keys move it.

type Listed = { id: string }

/** The same spend while it's listed; otherwise the newest, or none in an empty list. */
export function kept(list: readonly Listed[], selected: string | null): string | null {
  if (list.some((t) => t.id === selected)) return selected
  return list[0]?.id ?? null
}

/** What to select once `removed` is gone: the row below it, else the one above, else none. */
export function afterRemoving(list: readonly Listed[], removed: string): string | null {
  const at = list.findIndex((t) => t.id === removed)
  if (at === -1) return kept(list, null)
  return list[at + 1]?.id ?? list[at - 1]?.id ?? null
}

/** Where a key moves the selection; undefined for a key that doesn't move it. */
export function movedBy(
  list: readonly Listed[],
  selected: string | null,
  key: string,
): string | null | undefined {
  const at = list.findIndex((t) => t.id === selected)
  const to = {
    ArrowDown: at === -1 ? 0 : Math.min(at + 1, list.length - 1),
    ArrowUp: Math.max(at - 1, 0),
    Home: 0,
    End: list.length - 1,
  }[key]
  if (to === undefined) return undefined
  return list[to]?.id ?? null
}
