import { View, Text, StyleSheet, Alert } from 'react-native'
import { deleteSettlement, type GroupSettlement } from '@/lib/api'
import { Button } from './Button'
import { theme, cardStyle } from '@/lib/theme'

interface Props {
  settlements: GroupSettlement[]
  groupId: string
  onDeleted: () => void
}

/**
 * Settlements list for the History tab.
 *
 * TODO:
 * - Gate delete button: only visible to fromUser, toUser, or group creator
 * - Swipe-to-delete
 */
export function SettlementList({ settlements, groupId, onDeleted }: Props) {
  async function handleDelete(settlementId: string) {
    Alert.alert('Delete settlement', 'Remove this settlement record?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteSettlement(groupId, settlementId)
          onDeleted()
        },
      },
    ])
  }

  if (settlements.length === 0) {
    return <Text style={styles.empty}>No settlements recorded.</Text>
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>Settlements</Text>
      {settlements.map((s) => (
        <View key={s.id} style={styles.row}>
          <View style={styles.main}>
            <View style={styles.meta}>
              <View style={styles.transferLine}>
                <Text style={styles.transfer}>
                  <Text style={styles.bold}>{s.fromUserName ?? s.fromUserId}</Text>
                  {' → '}
                  <Text style={styles.bold}>{s.toUserName ?? s.toUserId}</Text>
                </Text>
                <View style={[styles.statusPill, s.status === 'pending' && styles.statusPillPending]}>
                  <Text
                    style={[styles.statusText, s.status === 'pending' && styles.statusTextPending]}
                  >
                    {s.status === 'pending' ? 'Pending' : 'Completed'}
                  </Text>
                </View>
              </View>
              <Text style={styles.submeta}>
                {s.date}
                {s.note ? ` · ${s.note}` : ''}
              </Text>
            </View>
            <View style={styles.amountBlock}>
              <Text style={styles.amount}>{s.amount}</Text>
              <View style={styles.currencyPill}>
                <Text style={styles.currencyText}>{s.currency}</Text>
              </View>
            </View>
          </View>
          <View style={styles.deleteFooter}>
            <Button
              title="Delete"
              variant="danger"
              size="sm"
              onPress={() => handleDelete(s.id)}
            />
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { marginBottom: theme.sp.md },
  sectionLabel: {
    fontSize: theme.text.xs,
    fontWeight: theme.weight.semibold,
    color: theme.color.textMuted,
    textTransform: 'uppercase',
    marginBottom: theme.sp.xs,
  },
  empty: { color: theme.color.textMuted, fontSize: theme.text.sm, marginBottom: theme.sp.md },
  row: {
    ...cardStyle,
    marginBottom: theme.sp.xs,
    overflow: 'hidden',
  },
  main: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.sp.sm,
  },
  meta: { flex: 1, marginRight: theme.sp.sm },
  transferLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.xs,
    flexWrap: 'wrap',
  },
  transfer: { fontSize: theme.text.sm, color: theme.color.text },
  bold: { fontWeight: theme.weight.semibold },
  statusPill: {
    backgroundColor: theme.color.successLight,
    borderRadius: theme.radius.lg,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  statusPillPending: { backgroundColor: theme.color.warningLight },
  statusText: {
    fontSize: 10,
    fontWeight: theme.weight.semibold,
    color: theme.color.success,
    textTransform: 'uppercase',
  },
  statusTextPending: { color: theme.color.warning },
  submeta: { fontSize: theme.text.xs, color: theme.color.textMuted, marginTop: 2 },
  amountBlock: { alignItems: 'flex-end' },
  amount: {
    fontSize: theme.text.base,
    fontWeight: theme.weight.semibold,
    color: theme.color.amountPositive,
  },
  currencyPill: {
    backgroundColor: theme.color.windowRaised,
    borderRadius: theme.radius.lg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
  },
  currencyText: {
    fontSize: theme.text.xs,
    color: theme.color.textMuted,
    fontWeight: theme.weight.semibold,
  },
  deleteFooter: {
    borderTopWidth: 1,
    borderTopColor: theme.color.ruleSoft,
    padding: theme.sp.xs,
    alignItems: 'center',
  },
})
