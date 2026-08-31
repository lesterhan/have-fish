import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAccount, fetchCashBalances, updateAccountType, type AccountBalance } from './api'
import {
  LAST_WALLET_KEY,
  resolveActiveWalletId,
  takenCurrencies,
  walletViews,
  type WalletView,
} from './cash-accounts'
import { walletCreateFailure, walletCreateRequest, type WalletCreateStep } from './cash-wallet-create'

interface WalletContextValue {
  /** Every cash wallet with its balance, in stable display order. */
  wallets: WalletView[]
  /** The selected wallet, or null when the user has none yet. */
  activeWallet: WalletView | null
  activeWalletId: string | null
  /** Currencies that already have a wallet — the create flow blocks these. */
  taken: Set<string>
  loading: boolean
  /** Non-null when the last load failed; the previous wallets stay on screen. */
  error: string | null
  setActiveWallet: (id: string) => void
  /** Re-fetch balances — after a spend, a top-up, or a pull-to-refresh. */
  reload: () => Promise<void>
  /** Create a wallet for `currency` and tag it as cash. Returns the new id. */
  createWallet: (currency: string) => Promise<string>
}

const WalletContext = createContext<WalletContextValue | null>(null)

/**
 * Owns the Cash mode's wallet state: the wallet list with balances, which one is
 * active, and the create flow. Lives above the Cash tabs so Spend, Wallets, and
 * Cash history share one source of truth and one refresh — the same shape as
 * `GroupProvider` on the Fish Pie side.
 *
 * Wallets are found strictly by their stored hledger type (`resolvedType ===
 * 'cash'`), which the `?types=cash` filter does server-side; nothing here
 * guesses from a path.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<WalletView[]>([])
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [taken, setTaken] = useState<Set<string>>(new Set())

  // Mirrors the state so the post-load resolve can read the user's latest pick
  // without making `load` depend on it (which would re-create it every select).
  const activeIdRef = useRef<string | null>(null)
  const applyActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id
    setActiveWalletId(id)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const balances: AccountBalance[] = await fetchCashBalances()
      const views = walletViews(balances)
      setWallets(views)
      setTaken(takenCurrencies(balances))
      // Prefer what's already selected; fall back to storage, then the first
      // wallet. A wallet deleted on the web must not leave the tab blank.
      const stored = activeIdRef.current ?? (await AsyncStorage.getItem(LAST_WALLET_KEY))
      applyActiveId(resolveActiveWalletId(stored, views))
      setError(null)
    } catch (e: any) {
      // Keep the last-known wallets on screen — a tailnet drop shouldn't blank
      // out balances the user was reading.
      setError(e?.message ?? 'Failed to load wallets')
    } finally {
      setLoading(false)
    }
  }, [applyActiveId])

  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    load()
  }, [load])

  const setActiveWallet = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return
      applyActiveId(id)
      AsyncStorage.setItem(LAST_WALLET_KEY, id).catch(() => null)
    },
    [applyActiveId],
  )

  /**
   * Create + tag, treated as one operation. An account created but not tagged is
   * an ordinary asset — invisible to the very screen that made it — so a failure
   * after the create reports which step failed and leaves the account in place
   * for a retry that resumes at the tag. Re-tagging is idempotent, so that retry
   * is safe; re-creating would mint a duplicate.
   */
  const createWallet = useCallback(
    async (currency: string) => {
      const request = walletCreateRequest(currency, taken)

      let step: WalletCreateStep = 'create'
      try {
        const account = await createAccount(request)
        step = 'tag'
        await updateAccountType(account.id, 'cash')
        await load()
        setActiveWallet(account.id)
        return account.id
      } catch (e: any) {
        const { message } = walletCreateFailure(step)
        // Surface the untagged account so a retry can find it rather than
        // creating a second one.
        if (step === 'tag') await load()
        throw new Error(e?.message ? `${message} (${e.message})` : message)
      }
    },
    [taken, load, setActiveWallet],
  )

  const activeWallet = useMemo(
    () => wallets.find((w) => w.id === activeWalletId) ?? null,
    [wallets, activeWalletId],
  )

  const value = useMemo<WalletContextValue>(
    () => ({
      wallets,
      activeWallet,
      activeWalletId,
      taken,
      loading,
      error,
      setActiveWallet,
      reload: load,
      createWallet,
    }),
    [wallets, activeWallet, activeWalletId, taken, loading, error, setActiveWallet, load, createWallet],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallets(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallets must be used within a WalletProvider')
  return ctx
}
