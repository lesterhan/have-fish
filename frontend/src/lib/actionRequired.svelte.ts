import { fetchActionRequiredSummary } from "./api"

type ActionRequiredEntry = { accountId: string; count: number }

const store = $state<{ value: ActionRequiredEntry[] | null }>({ value: null })
let pending: Promise<ActionRequiredEntry[]> | null = null

export const actionRequiredStore = {
  get value() {
    return store.value
  },

  /** Fetch the bulk summary once; subsequent calls return the cached result. */
  load(): Promise<ActionRequiredEntry[]> {
    if (store.value) return Promise.resolve(store.value)
    if (!pending) {
      pending = fetchActionRequiredSummary().then((s) => {
        store.value = s
        return s
      })
    }
    return pending
  },

  /**
   * Returns the action-required count for one account.
   * null  = store not yet loaded (show neutral state)
   * 0     = all clear
   * n > 0 = needs action
   */
  getCount(accountId: string): number | null {
    if (store.value === null) return null
    return store.value.find((e) => e.accountId === accountId)?.count ?? 0
  },

  /** Invalidate so the next load() re-fetches from the server. */
  invalidate() {
    store.value = null
    pending = null
  },
}
