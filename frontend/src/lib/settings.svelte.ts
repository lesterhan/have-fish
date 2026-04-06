import type { UserSettings } from './api'

// Shared reactive singleton — the layout populates this after fetch,
// any page can read or update it and the sidebar will react automatically.
export const settingsStore = $state<{ value: UserSettings | null }>({ value: null })
