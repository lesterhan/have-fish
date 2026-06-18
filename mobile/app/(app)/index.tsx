import { GroupScreen } from '@/components/GroupScreen'
import { SpeedEntry } from '@/components/SpeedEntry'

/**
 * Add tab — the shell's home and the design's single-job speed-entry screen
 * (Companion epic 2). The screen owns its own padding, so the GroupScreen
 * scaffold contributes none.
 */
export default function AddScreen() {
  return (
    <GroupScreen contentStyle={{ padding: 0 }}>
      {({ group, reloadData }) => <SpeedEntry group={group} onExpenseAdded={reloadData} />}
    </GroupScreen>
  )
}
