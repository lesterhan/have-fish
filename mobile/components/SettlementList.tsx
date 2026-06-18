import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { deleteSettlement, type GroupSettlement } from '@/lib/api'

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
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDelete(s.id)}
          >
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  empty: { color: '#888', fontSize: 13, marginBottom: 16 },
  row: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 8,
    overflow: 'hidden',
  },
  main: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  meta: { flex: 1, marginRight: 12 },
  transferLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  transfer: { fontSize: 14, color: '#1a1a1a' },
  bold: { fontWeight: '600' },
  statusPill: {
    backgroundColor: '#dcfce7',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  statusPillPending: { backgroundColor: '#fef3c7' },
  statusText: { fontSize: 10, fontWeight: '700', color: '#16a34a', textTransform: 'uppercase' },
  statusTextPending: { color: '#b45309' },
  submeta: { fontSize: 12, color: '#888', marginTop: 2 },
  amountBlock: { alignItems: 'flex-end' },
  amount: { fontSize: 16, fontWeight: '700', color: '#27ae60' },
  currencyPill: {
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
  },
  currencyText: { fontSize: 11, color: '#666', fontWeight: '600' },
  deleteButton: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    padding: 8,
    alignItems: 'center',
  },
  deleteText: { fontSize: 12, color: '#e74c3c' },
})
