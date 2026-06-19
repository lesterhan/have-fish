import { BalancesPanel } from '@/components/BalancesPanel'
import { GroupScreen } from '@/components/GroupScreen'

/**
 * Balances tab — per-currency balance cards plus the cross-currency batch
 * settle-up flow (Companion epic 3). All orchestration lives in BalancesPanel.
 */
export default function BalancesScreen() {
  return (
    <GroupScreen refreshOnFocus>
      {({ group, data, reloadData }) => (
        <BalancesPanel
          group={group}
          balances={data.balances}
          settlements={data.settlements}
          reloadData={reloadData}
        />
      )}
    </GroupScreen>
  )
}
