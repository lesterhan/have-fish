import { CashSpend } from '@/components/CashSpend'

/**
 * Spend tab — the Cash ledger's entry screen: pick the amount, describe it, and
 * split it across as many expense accounts as the purchase needs. Wallet state
 * comes from WalletProvider in the shell layout.
 */
export default function CashSpendScreen() {
  return <CashSpend />
}
