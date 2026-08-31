import { CashHistoryPanel } from '@/components/CashHistoryPanel'

/**
 * Cash history tab — every transaction touching the active wallet, with a
 * running balance to reconcile against the notes in your pocket. Wallet state
 * comes from WalletProvider in the shell layout.
 */
export default function CashHistoryScreen() {
  return <CashHistoryPanel />
}
