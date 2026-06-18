import { useCallback, useState } from 'react'
import { View, StyleSheet, ActivityIndicator, ScrollView } from 'react-native'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import {
  fetchGroup,
  fetchExpenses,
  fetchBalances,
  fetchSettlements,
  fetchGroupInvites,
  type ExpenseGroup,
  type GroupExpense,
  type CurrencyBalance,
  type GroupSettlement,
  type GroupInvite,
} from '@/lib/api'
import { ExpenseForm } from '@/components/ExpenseForm'
import { BalanceCard } from '@/components/BalanceCard'
import { ExpenseList } from '@/components/ExpenseList'
import { SettlementList } from '@/components/SettlementList'
import { GroupSettingsPanel } from '@/components/GroupSettingsPanel'
import { ScreenHeader } from '@/components/ScreenHeader'
import { SegmentedTabs } from '@/components/SegmentedTabs'
import { theme } from '@/lib/theme'

type Tab = 'add' | 'balances' | 'history' | 'settings'

/**
 * Group detail screen — 4-tab layout.
 *
 * Add       — expense entry form
 * Balances  — net positions (view-only; settle on web until story 6)
 * History   — expenses + settlements list
 * Settings  — name, currency, members, invites, delete
 *
 * TODO:
 * - Pass currentUserId down from auth context so child components can gate
 *   delete/edit permissions (payer/creator checks)
 * - Re-fetch balances automatically after expense/settlement is added
 * - Show an offline badge in the header if getOfflineQueue() is non-empty
 */
export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const [group, setGroup] = useState<ExpenseGroup | null>(null)
  const [expenses, setExpenses] = useState<GroupExpense[]>([])
  const [balances, setBalances] = useState<CurrencyBalance[]>([])
  const [settlements, setSettlements] = useState<GroupSettlement[]>([])
  const [invites, setInvites] = useState<GroupInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('add')

  async function load() {
    try {
      const [g, e, b, s, i] = await Promise.all([
        fetchGroup(id),
        fetchExpenses(id),
        fetchBalances(id),
        fetchSettlements(id),
        fetchGroupInvites(id),
      ])
      setGroup(g)
      setExpenses(e)
      setBalances(b)
      setSettlements(s)
      setInvites(i.filter((inv) => inv.status === 'pending'))
    } finally {
      setLoading(false)
    }
  }

  async function refreshBalancesAndHistory() {
    const [b, s, e] = await Promise.all([
      fetchBalances(id),
      fetchSettlements(id),
      fetchExpenses(id),
    ])
    setBalances(b)
    setSettlements(s)
    setExpenses(e)
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true)
      load()
    }, [id]),
  )

  if (loading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title={group.name} onBack={() => router.back()} />

      <SegmentedTabs<Tab>
        tabs={['add', 'balances', 'history', 'settings']}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* Tab content */}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
        {activeTab === 'add' && (
          <ExpenseForm
            group={group}
            onExpenseAdded={refreshBalancesAndHistory}
          />
        )}

        {activeTab === 'balances' && (
          <BalanceCard balances={balances} members={group.members} />
        )}

        {activeTab === 'history' && (
          <>
            <ExpenseList
              expenses={expenses}
              groupId={id}
              categories={group.categories}
              onDeleted={refreshBalancesAndHistory}
              onChanged={refreshBalancesAndHistory}
            />
            <SettlementList
              settlements={settlements}
              groupId={id}
              onDeleted={refreshBalancesAndHistory}
            />
          </>
        )}
        {/* Settlement creation/confirmation is deferred to mobile-revival
            story 6 — balances are view-only in the MVP. */}

        {activeTab === 'settings' && (
          <GroupSettingsPanel
            group={group}
            invites={invites}
            onGroupUpdated={load}
            onGroupDeleted={() => router.replace('/(app)')}
          />
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.desktop },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.color.desktop,
  },
  content: { flex: 1 },
  contentPad: { padding: theme.sp.md, paddingBottom: theme.sp.xl },
})
