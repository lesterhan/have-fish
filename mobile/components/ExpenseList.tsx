import { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native'
import { deleteExpense, updateExpense, type GroupCategory, type GroupExpense } from '@/lib/api'

interface Props {
  expenses: GroupExpense[]
  groupId: string
  /** Active categories for the group, for inline recategorization. */
  categories: GroupCategory[]
  onDeleted: () => void
  /** Called after an expense is recategorized so balances/history refresh. */
  onChanged: () => void
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
export function ExpenseList({ expenses, groupId, categories, onDeleted, onChanged }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [recategorizing, setRecategorizing] = useState<string | null>(null)

  const activeCategories = categories
    .filter((c) => !c.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder)

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

  // Recategorize an expense. Tapping the current category clears it (null).
  async function handleRecategorize(expense: GroupExpense, nextId: string) {
    const categoryId = expense.categoryId === nextId ? null : nextId
    setRecategorizing(expense.id)
    try {
      await updateExpense(groupId, expense.id, { categoryId })
      onChanged()
    } catch (e: any) {
      Alert.alert('Could not recategorize', e.message ?? 'Please try again.')
    } finally {
      setRecategorizing(null)
    }
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
              {expense.categoryName ? (
                <View style={styles.categoryPill}>
                  <Text style={styles.categoryPillText}>{expense.categoryName}</Text>
                </View>
              ) : null}
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

              {activeCategories.length > 0 && (
                <>
                  <Text style={styles.recatLabel}>Category</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.recatRow}
                  >
                    {activeCategories.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.recatChip, expense.categoryId === c.id && styles.recatChipActive]}
                        disabled={recategorizing === expense.id}
                        onPress={() => handleRecategorize(expense, c.id)}
                      >
                        <Text
                          style={[
                            styles.recatChipText,
                            expense.categoryId === c.id && styles.recatChipTextActive,
                          ]}
                        >
                          {c.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}

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
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  categoryPillText: { fontSize: 11, color: '#2563eb', fontWeight: '600' },
  recatLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    marginTop: 8,
  },
  recatRow: { marginTop: 6 },
  recatChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ccc',
    marginRight: 8,
    backgroundColor: '#fff',
  },
  recatChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  recatChipText: { fontSize: 12, color: '#444' },
  recatChipTextActive: { color: '#fff', fontWeight: '600' },
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
