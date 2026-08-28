import { WalletsPanel } from '@/components/WalletsPanel'

/**
 * Wallets tab — per-currency cash balances, the active-wallet picker, and the
 * create-a-wallet flow for a ledger with nothing tagged Cash yet. All
 * orchestration lives in WalletsPanel; wallet state comes from WalletProvider
 * in the shell layout.
 */
export default function CashWalletsScreen() {
  return <WalletsPanel />
}
