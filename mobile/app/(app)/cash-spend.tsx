import { CashPlaceholder } from '@/components/CashPlaceholder'

/**
 * Spend tab — the Cash ledger's entry screen: pick a wallet, enter an amount,
 * split it across one or more expense accounts, save. Built in story 4 of the
 * Mobile Cash Ledger epic; story 2 only stakes out the route so the shell has a
 * complete Cash tab set to switch to.
 */
export default function CashSpendScreen() {
  return (
    <CashPlaceholder
      title="Spend"
      detail="Log cash you have spent, split across as many expense accounts as the purchase needs."
      story="Story 4"
    />
  )
}
