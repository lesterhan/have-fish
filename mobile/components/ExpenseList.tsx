import { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native'
import { deleteExpense, updateExpense, type GroupCategory, type GroupExpense } from '@/lib/api'
import { Chip } from './Chip'
import { Button } from './Button'
import { theme, cardStyle } from '@/lib/theme'

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
                    contentContainerStyle={styles.chipStrip}
                  >
                    {activeCategories.map((c) => (
                      <Chip
                        key={c.id}
                        label={c.name}
                        active={expense.categoryId === c.id}
                        disabled={recategorizing === expense.id}
                        onPress={() => handleRecategorize(expense, c.id)}
                      />
                    ))}
                  </ScrollView>
                </>
              )}

              <Button
                title="Delete expense"
                variant="danger"
                size="sm"
                onPress={() => handleDelete(expense.id, expense.description)}
                style={styles.deleteButton}
              />
            </View>
          )}
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
  description: {
    fontSize: theme.text.sm,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
  },
  submeta: { fontSize: theme.text.xs, color: theme.color.textMuted, marginTop: 2 },
  amountBlock: { alignItems: 'flex-end' },
  amount: { fontSize: theme.text.base, fontWeight: theme.weight.semibold, color: theme.color.text },
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
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: theme.color.accentChipBg,
    borderWidth: 1,
    borderColor: theme.color.accentHi,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.sp.xs,
    paddingVertical: 2,
    marginTop: 4,
  },
  categoryPillText: {
    fontSize: theme.text.xs,
    color: theme.color.accentChipFg,
    fontWeight: theme.weight.semibold,
  },
  recatLabel: {
    fontSize: theme.text.xs,
    fontWeight: theme.weight.semibold,
    color: theme.color.textMuted,
    textTransform: 'uppercase',
    marginTop: theme.sp.xs,
  },
  recatRow: { marginTop: 6 },
  chipStrip: { gap: theme.sp.xs },
  splits: {
    borderTopWidth: 1,
    borderTopColor: theme.color.ruleSoft,
    padding: theme.sp.sm,
    gap: 4,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  splitName: { fontSize: theme.text.sm, color: theme.color.textMuted },
  splitAmount: {
    fontSize: theme.text.sm,
    color: theme.color.textMuted,
    fontWeight: theme.weight.semibold,
  },
  deleteButton: { marginTop: theme.sp.xs },
})
