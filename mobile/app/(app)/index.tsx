import { ExpenseForm } from '@/components/ExpenseForm'
import { GroupScreen } from '@/components/GroupScreen'

/**
 * Add tab — the shell's home. Interim: hosts the existing expense form for the
 * active group. Epic 2 replaces this with the numpad speed-entry screen.
 */
export default function AddScreen() {
  return (
    <GroupScreen>
      {({ group, reloadData }) => <ExpenseForm group={group} onExpenseAdded={reloadData} />}
    </GroupScreen>
  )
}
