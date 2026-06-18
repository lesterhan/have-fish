import { useCallback, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.groupName} numberOfLines={1}>
          {group.name}
        </Text>
        <View style={{ width: 56 }} />
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['add', 'balances', 'history', 'settings'] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: { width: 56 },
  backText: { fontSize: 16, color: '#2563eb' },
  groupName: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700' },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#2563eb' },
  tabText: { fontSize: 13, color: '#888' },
  tabTextActive: { color: '#2563eb', fontWeight: '600' },
  content: { flex: 1 },
  contentPad: { padding: 16, paddingBottom: 32 },
})
