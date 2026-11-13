// Which item a list keeps selected as the list changes. The keys are the Listbox's (parts/listbox.ts).

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
