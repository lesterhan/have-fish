// Signals the root layout to re-fetch sidebar account balances.
// Any page/component can call sidebarRefresh.bump() after mutating data.
const sidebarRefresh = $state({ count: 0 })

export function bump() {
  sidebarRefresh.count++
}

export default sidebarRefresh
