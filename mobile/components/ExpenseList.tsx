import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { deleteExpense, type GroupExpense } from '@/lib/api'

interface Props {
  expenses: GroupExpense[]
  groupId: string
  onDeleted: () => void
}

/**
 * Expenses list for the History tab.
 *
 * TODO:
 * - Swipe-to-delete (react-native-gesture-handler Swipeable)
 * - Gate the delete button so only payer/group-creator sees it
 *   (requires currentUserId + group.createdBy passed down)
 * - Group expenses by date with section headers
 */
export function ExpenseList({ expenses, groupId, onDeleted }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

  async function handleDelete(expenseId: string, description: string) {
    Alert.alert('Delete expense', `Delete "${description}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteExpense(groupId, expenseId)
          onDeleted()
        },
      },
    ])
  }

  if (expenses.length === 0) {
    return <Text style={styles.empty}>No expenses yet.</Text>
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>Expenses</Text>
      {expenses.map((expense) => (
        <View key={expense.id} style={styles.row}>
          <TouchableOpacity
            style={styles.main}
            onPress={() => setExpanded(expanded === expense.id ? null : expense.id)}
          >
            <View style={styles.meta}>
              <Text style={styles.description}>{expense.description}</Text>
              <Text style={styles.submeta}>
                {expense.date} · paid by {expense.payerName ?? expense.paidByUserId}
              </Text>
            </View>
            <View style={styles.amountBlock}>
              <Text style={styles.amount}>{expense.amount}</Text>
              <View style={styles.currencyPill}>
                <Text style={styles.currencyText}>{expense.currency}</Text>
              </View>
            </View>
          </TouchableOpacity>

          {expanded === expense.id && (
            <View style={styles.splits}>
              {expense.splits.map((split) => (
                <View key={split.id} style={styles.splitRow}>
                  <Text style={styles.splitName}>{split.userName}</Text>
                  <Text style={styles.splitAmount}>{split.amount}</Text>
                </View>
              ))}
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDelete(expense.id, expense.description)}
              >
                <Text style={styles.deleteText}>Delete expense</Text>
              </TouchableOpacity>
            </View>
          )}
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
  description: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  submeta: { fontSize: 12, color: '#888', marginTop: 2 },
  amountBlock: { alignItems: 'flex-end' },
  amount: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  currencyPill: {
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
  },
  currencyText: { fontSize: 11, color: '#666', fontWeight: '600' },
  splits: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    padding: 12,
    gap: 4,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  splitName: { fontSize: 13, color: '#555' },
  splitAmount: { fontSize: 13, color: '#555', fontWeight: '600' },
  deleteButton: {
    marginTop: 8,
    padding: 8,
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  deleteText: { fontSize: 13, color: '#e74c3c' },
})
