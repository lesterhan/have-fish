import { useCallback, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { fetchTransactions, type Transaction } from '@/lib/api'
import { formatAmount } from '@/lib/cash-accounts'
import {
  cashHistoryRows,
  dayHeading,
  groupByDay,
  type CashHistoryRow,
} from '@/lib/cash-history'
import { useShellMode } from '@/lib/shell-mode-context'
import { useWallets } from '@/lib/wallet-context'
import { theme } from '@/lib/theme'
import { GlossSurface } from './GlossSurface'

/**
 * Cash history — every transaction touching the active wallet, newest first,
 * with a running balance to check against the notes in your pocket.
 *
 * A split purchase is one row naming its categories, because it was one
 * payment. A cash-funded Fish Pie expense gets the group's name and your share,
 * because the raw three legs read as an anonymous list. All of that shaping is
 * in `lib/cash-history.ts`; this renders it.
 */
export function CashHistoryPanel() {
  const { activeWallet } = useWallets()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const walletId = activeWallet?.id ?? null

  const load = useCallback(async () => {
    if (!walletId) {
      setTransactions([])
      return
    }
    setLoading(true)
    try {
      setTransactions(await fetchTransactions({ accountId: walletId }))
      setError(null)
    } catch (e: any) {
      // Keep the last feed on screen; a dropped tailnet shouldn't blank it.
      setError(e?.message ?? 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [walletId])

  // Refresh on focus so a spend or top-up made elsewhere shows up on return.
  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  if (!activeWallet) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No wallet yet — make one on the Wallets tab.</Text>
      </View>
    )
  }

  const rows = cashHistoryRows({
    transactions,
    walletId: activeWallet.id,
    currency: activeWallet.currency ?? '',
    currentBalance: activeWallet.amount,
  })
  const days = groupByDay(rows)
  const now = new Date()

  if (loading && rows.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {error != null && <Text style={styles.error}>{error}</Text>}

      {rows.length === 0 ? (
        <Text style={styles.empty}>
          Nothing spent from {activeWallet.label} yet. Anything you log on the Spend tab shows up
          here.
        </Text>
      ) : (
        days.map((day) => (
          <View key={day.date} style={styles.day}>
            <Text style={styles.dayHeading}>{dayHeading(day.date, now)}</Text>
            <GlossSurface style={styles.dayCard}>
              {day.rows.map((row, i) => (
                <HistoryRow key={row.id} row={row} first={i === 0} />
              ))}
            </GlossSurface>
          </View>
        ))
      )}
    </ScrollView>
  )
}

function HistoryRow({ row, first }: { row: CashHistoryRow; first: boolean }) {
  const { accent } = useShellMode()
  const incoming = parseFloat(row.amount) > 0

  return (
    <View style={[styles.row, !first && styles.rowDivided]}>
      <View style={styles.rowMain}>
        <Text style={styles.description} numberOfLines={1}>
          {row.description}
        </Text>

        <View style={styles.metaRow}>
          {/* Without this a cash-funded group expense reads as three anonymous
              legs; the group's name is what makes it legible. */}
          {row.groupName != null && (
            <View style={[styles.badge, { backgroundColor: accent.soft, borderColor: accent.line }]}>
              <Text style={[styles.badgeText, { color: accent.ink }]} numberOfLines={1}>
                {row.groupName}
              </Text>
            </View>
          )}
          {row.counterparties.length > 0 && (
            <Text style={styles.counterparties} numberOfLines={1}>
              {row.counterparties.join(' · ')}
            </Text>
          )}
        </View>

        {/* You fronted the whole amount but only consumed your share — both
            numbers matter, and only one of them is the wallet movement. */}
        {row.share != null && (
          <Text style={styles.share}>your share {formatAmount(row.share)}</Text>
        )}
      </View>

      <View style={styles.rowAmounts}>
        <Text style={[styles.amount, incoming ? styles.amountIn : styles.amountOut]}>
          {formatAmount(row.amount)}
        </Text>
        <Text style={styles.balance}>{formatAmount(row.balanceAfter)}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.appBg },
  content: { padding: theme.sp.md, gap: theme.sp.sm, paddingBottom: theme.sp.lg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.appBg,
    padding: theme.sp.lg,
  },
  empty: {
    fontSize: theme.text.sm,
    color: theme.color.ink2,
    textAlign: 'center',
    lineHeight: 20,
  },
  error: { fontSize: theme.text.sm, color: theme.color.red, textAlign: 'center' },
  day: { gap: 6 },
  dayHeading: {
    fontFamily: theme.font.monoMedium,
    fontSize: theme.text.xs,
    color: theme.color.ink3,
    marginLeft: 2,
  },
  dayCard: { paddingHorizontal: theme.sp.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.sp.xs, paddingVertical: 10 },
  rowDivided: { borderTopWidth: 1, borderTopColor: theme.color.lineSoft },
  rowMain: { flex: 1, gap: 2 },
  description: { fontSize: theme.text.sm, color: theme.color.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    maxWidth: 120,
  },
  badgeText: { fontSize: 10, fontWeight: theme.weight.medium },
  counterparties: {
    flexShrink: 1,
    fontSize: theme.text.xs,
    color: theme.color.ink3,
  },
  share: { fontFamily: theme.font.mono, fontSize: 10.5, color: theme.color.ink2 },
  rowAmounts: { alignItems: 'flex-end', gap: 2 },
  amount: { fontFamily: theme.font.monoSemibold, fontSize: theme.text.sm },
  amountOut: { color: theme.color.ink },
  amountIn: { color: theme.color.green },
  balance: { fontFamily: theme.font.mono, fontSize: 10.5, color: theme.color.ink3 },
})
