import { BalanceCard } from '@/components/BalanceCard'
import { GroupScreen } from '@/components/GroupScreen'

/**
 * Balances tab — interim view over the existing balance card. Epic 3 rebuilds
 * this as per-currency gloss cards with settlement.
 */
export default function BalancesScreen() {
  return (
    <GroupScreen refreshOnFocus>
      {({ group, data }) => <BalanceCard balances={data.balances} members={group.members} />}
    </GroupScreen>
  )
}
