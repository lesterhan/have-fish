import { StyleSheet, Text, View } from 'react-native'
import type { GroupExpense, GroupSettlement } from '@/lib/api'
import { historyView, type SettlementBadge } from '@/lib/history-view'
import { theme } from '@/lib/theme'
import { Avatar } from './Avatar'
import { Label } from './Label'

interface Props {
  expenses: GroupExpense[]
  settlements: GroupSettlement[]
}

/**
 * History tab body — the scannable feed of recent expenses then settlements,
 * each as edge-to-edge rows with a hairline divider (no cards). Reads its rows
 * from the pure {@link historyView} model so the markup stays declarative.
 * Refresh is owned by the screen's `GroupScreen` (refresh-on-focus + shared
 * cross-tab reload after Add / settle).
 */
export function HistoryPanel({ expenses, settlements }: Props) {
  const view = historyView(expenses, settlements)

  return (
    <View>
      <View style={styles.sectionHead}>
        <Label>{`Expenses ${view.expenseCount}`}</Label>
      </View>
      {view.expenses.length === 0 ? (
        <Text style={styles.empty}>No expenses yet.</Text>
      ) : (
        view.expenses.map((e) => (
          <View key={e.id} style={styles.expenseRow}>
            <Avatar name={e.payer} size={32} />
            <View style={styles.middle}>
              <Text style={styles.description} numberOfLines={1}>
                {e.description}
              </Text>
              <View style={styles.metaLine}>
                <Text style={styles.meta} numberOfLines={1}>
                  {e.date} · {e.payer}
                </Text>
                {e.category && (
                  <View style={styles.catTag}>
                    <Text style={styles.catTagText}>{e.category}</Text>
                  </View>
                )}
              </View>
            </View>
            <View style={styles.amountBlock}>
              <Text style={styles.amount}>{e.amount}</Text>
              <Text style={styles.currency}>{e.currency}</Text>
            </View>
          </View>
        ))
      )}

      <View style={[styles.sectionHead, styles.settlementsHead]}>
        <Label>{`Settlements ${view.settlementCount}`}</Label>
      </View>
      {view.settlements.length === 0 ? (
        <Text style={styles.empty}>No settlements yet.</Text>
      ) : (
        view.settlements.map((s) => (
          <View key={s.id} style={styles.settlementRow}>
            <View style={styles.middle}>
              <View style={styles.directionLine}>
                <Text style={styles.direction} numberOfLines={1}>
                  {s.from} → {s.to}
                </Text>
                <View style={[styles.badge, BADGE_BG[s.status]]}>
                  <Text style={[styles.badgeText, BADGE_FG[s.status]]}>{s.statusLabel}</Text>
                </View>
              </View>
              <Text style={styles.meta}>{s.date}</Text>
            </View>
            <View style={styles.amountBlock}>
              <Text style={styles.amountSettled}>{s.amount}</Text>
              <Text style={styles.currency}>{s.currency}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  )
}

const BADGE_BG: Record<SettlementBadge, { backgroundColor: string }> = {
  completed: { backgroundColor: theme.color.greenBg },
  pending: { backgroundColor: theme.color.accentSoft },
}
const BADGE_FG: Record<SettlementBadge, { color: string }> = {
  completed: { color: theme.color.green },
  pending: { color: theme.color.accentInk },
}

const styles = StyleSheet.create({
  sectionHead: { paddingHorizontal: theme.sp.md, paddingTop: theme.sp.xs, paddingBottom: theme.sp[4] },
  settlementsHead: { paddingTop: theme.sp.md },
  empty: {
    fontFamily: theme.font.mono,
    fontSize: theme.text.xs,
    color: theme.color.ink3,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
  },

  // ── Expense row: avatar | middle | amount ──
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
    paddingVertical: theme.sp[11],
    paddingHorizontal: theme.sp.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.lineSoft,
  },
  middle: { flex: 1, minWidth: 0 },
  description: {
    fontFamily: theme.font.sans,
    fontSize: 14.5,
    fontWeight: theme.weight.semibold,
    color: theme.color.ink,
  },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: theme.sp[7], marginTop: 3 },
  meta: {
    flexShrink: 1,
    fontFamily: theme.font.mono,
    fontSize: 11,
    color: theme.color.ink3,
  },
  catTag: {
    backgroundColor: theme.color.surface2,
    borderWidth: 1,
    borderColor: theme.color.lineSoft,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  catTagText: {
    fontFamily: theme.font.monoBold,
    fontSize: 9.5,
    letterSpacing: 0.4,
    color: theme.color.ink2,
  },
  amountBlock: { alignItems: 'flex-end' },
  amount: {
    fontFamily: theme.font.monoBold,
    fontSize: 15,
    color: theme.color.ink,
  },
  amountSettled: {
    fontFamily: theme.font.monoBold,
    fontSize: 15,
    color: theme.color.green,
  },
  currency: {
    fontFamily: theme.font.mono,
    fontSize: 10,
    color: theme.color.ink3,
    marginTop: 1,
  },

  // ── Settlement row: middle | amount ──
  settlementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
    paddingVertical: theme.sp[11],
    paddingHorizontal: theme.sp.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.lineSoft,
  },
  directionLine: { flexDirection: 'row', alignItems: 'center', gap: theme.sp[7] },
  direction: {
    flexShrink: 1,
    fontFamily: theme.font.sans,
    fontSize: 14.5,
    fontWeight: theme.weight.semibold,
    color: theme.color.ink,
  },
  badge: {
    borderWidth: 1,
    borderColor: theme.color.lineSoft,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: theme.font.monoBold,
    fontSize: 8.5,
    letterSpacing: 0.4,
  },
})
