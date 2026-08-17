import { fetchUserSettings, updateUserSettings } from './api'
import type { UserSettings } from './api'

const store = $state<{ value: UserSettings | null }>({ value: null })

// One in-flight fetch at a time — subsequent callers get the same promise.
let pending: Promise<UserSettings> | null = null

export const settingsStore = {
  get value() {
    return store.value
  },

  /**
   * Seed the cache from settings a server `load` already fetched, so the first `load()`
   * call on the client resolves without a round trip. No-op once the store is populated.
   */
  prime(settings: UserSettings): void {
    if (!store.value) store.value = settings
  },

  /** Fetch settings once; subsequent calls return the cached result. */
  load(): Promise<UserSettings> {
    if (store.value) return Promise.resolve(store.value)
    if (!pending) {
      pending = fetchUserSettings().then((s) => {
        store.value = s
        return s
      })
    }
    return pending
  },

  /** Patch settings on the server and update the store. */
  async update(body: Parameters<typeof updateUserSettings>[0]): Promise<void> {
    const updated = await updateUserSettings(body)
    store.value = updated
  },
}
