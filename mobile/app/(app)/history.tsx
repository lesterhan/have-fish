import { HistoryPanel } from '@/components/HistoryPanel'
import { GroupScreen } from '@/components/GroupScreen'
import { theme } from '@/lib/theme'

/**
 * History tab — the scannable Companion feed of recent expenses then
 * settlements. Rows are edge-to-edge (their own 16px padding + hairline
 * dividers), so the scaffold's default padding is dropped here. Refreshes on
 * focus and after Add / settlement via the shared group state.
 */
export default function HistoryScreen() {
  return (
    <GroupScreen
      refreshOnFocus
      contentStyle={{ padding: 0, paddingBottom: theme.sp.md }}
    >
      {({ data }) => (
        <HistoryPanel expenses={data.expenses} settlements={data.settlements} />
      )}
    </GroupScreen>
  )
}
