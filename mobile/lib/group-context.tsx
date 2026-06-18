import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  fetchGroups,
  fetchGroup,
  fetchExpenses,
  fetchBalances,
  fetchSettlements,
  type ExpenseGroup,
  type GroupExpense,
  type CurrencyBalance,
  type GroupSettlement,
} from '@/lib/api'
import { LAST_GROUP_KEY, resolveActiveGroupId } from '@/lib/group-store'

interface GroupData {
  expenses: GroupExpense[]
  balances: CurrencyBalance[]
  settlements: GroupSettlement[]
}

const EMPTY_DATA: GroupData = { expenses: [], balances: [], settlements: [] }

interface GroupContextValue {
  /** All of the user's groups (newest fetch). */
  groups: ExpenseGroup[]
  /** Currently selected group id, or null if the user has none. */
  activeGroupId: string | null
  /** The active group's full detail (members, categories). */
  group: ExpenseGroup | null
  /** The active group's expenses / balances / settlements. */
  data: GroupData
  loadingGroups: boolean
  loadingData: boolean
  error: string | null
  /** Switch group, persist as last-visited, and load its data. */
  setActiveGroup: (id: string) => void
  /** Re-fetch the group list (after create / join). */
  reloadGroups: () => Promise<void>
  /** Re-fetch the active group's detail + data — the shared cross-tab refresh
   *  fired after an expense is added or a settlement changes. */
  reloadData: () => Promise<void>
}

const GroupContext = createContext<GroupContextValue | null>(null)

/**
 * Owns the Companion shell's group state: the group list, the active group, and
 * that group's data bundle. Lives above the tab navigator so Add / Balances /
 * History share one source of truth and one refresh.
 */
export function GroupProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<ExpenseGroup[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [group, setGroup] = useState<ExpenseGroup | null>(null)
  const [data, setData] = useState<GroupData>(EMPTY_DATA)
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDataFor = useCallback(async (id: string) => {
    setLoadingData(true)
    try {
      const [g, expenses, balances, settlements] = await Promise.all([
        fetchGroup(id),
        fetchExpenses(id),
        fetchBalances(id),
        fetchSettlements(id),
      ])
      // Guard against a race where the user switched groups mid-fetch.
      setActiveGroupId((current) => {
        if (current === id) {
          setGroup(g)
          setData({ expenses, balances, settlements })
        }
        return current
      })
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load group')
    } finally {
      setLoadingData(false)
    }
  }, [])

  const reloadGroups = useCallback(async () => {
    setLoadingGroups(true)
    try {
      const list = await fetchGroups()
      setGroups(list)
      const stored = await AsyncStorage.getItem(LAST_GROUP_KEY)
      setActiveGroupId((current) => {
        const next = resolveActiveGroupId(current ?? stored, list)
        if (next && next !== current) loadDataFor(next)
        if (!next) {
          setGroup(null)
          setData(EMPTY_DATA)
        }
        return next
      })
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load groups')
    } finally {
      setLoadingGroups(false)
    }
  }, [loadDataFor])

  const setActiveGroup = useCallback(
    (id: string) => {
      if (id === activeGroupId) return
      setActiveGroupId(id)
      setGroup(groups.find((g) => g.id === id) ?? null)
      setData(EMPTY_DATA)
      AsyncStorage.setItem(LAST_GROUP_KEY, id).catch(() => null)
      loadDataFor(id)
    },
    [activeGroupId, groups, loadDataFor],
  )

  const reloadData = useCallback(async () => {
    if (activeGroupId) await loadDataFor(activeGroupId)
  }, [activeGroupId, loadDataFor])

  useEffect(() => {
    reloadGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<GroupContextValue>(
    () => ({
      groups,
      activeGroupId,
      group,
      data,
      loadingGroups,
      loadingData,
      error,
      setActiveGroup,
      reloadGroups,
      reloadData,
    }),
    [
      groups,
      activeGroupId,
      group,
      data,
      loadingGroups,
      loadingData,
      error,
      setActiveGroup,
      reloadGroups,
      reloadData,
    ],
  )

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>
}

export function useGroups(): GroupContextValue {
  const ctx = useContext(GroupContext)
  if (!ctx) throw new Error('useGroups must be used within a GroupProvider')
  return ctx
}
