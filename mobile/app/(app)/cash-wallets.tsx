import { CashPlaceholder } from '@/components/CashPlaceholder'

/**
 * Wallets tab — per-currency cash balances, the active-wallet picker, and the
 * create-a-wallet flow for a ledger with nothing tagged Cash yet. Built in
 * story 3; story 2 only stakes out the route.
 */
export default function CashWalletsScreen() {
  return (
    <CashPlaceholder
      title="Wallets"
      detail="What is in each wallet, currency by currency — and the flow to create your first one."
      story="Story 3"
    />
  )
}
