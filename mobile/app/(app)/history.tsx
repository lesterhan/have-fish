import { ExpenseList } from '@/components/ExpenseList'
import { SettlementList } from '@/components/SettlementList'
import { GroupScreen } from '@/components/GroupScreen'
import { theme } from '@/lib/theme'

/**
 * History tab — interim list over the existing expense + settlement lists.
 * Epic 4 rebuilds this as the scannable Companion feed.
 */
export default function HistoryScreen() {
  return (
    <GroupScreen refreshOnFocus contentStyle={{ paddingBottom: theme.sp.xl }}>
      {({ group, data, reloadData }) => (
        <>
          <ExpenseList
            expenses={data.expenses}
            groupId={group.id}
            categories={group.categories}
            onDeleted={reloadData}
            onChanged={reloadData}
          />
          <SettlementList settlements={data.settlements} groupId={group.id} onDeleted={reloadData} />
        </>
      )}
    </GroupScreen>
  )
}
