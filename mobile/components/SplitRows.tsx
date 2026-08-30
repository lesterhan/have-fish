import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { accountLeaf } from '@/lib/account-search'
import type { Account } from '@/lib/api'
import type { SplitRow } from '@/lib/cash-entry'
import { useShellMode } from '@/lib/shell-mode-context'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { Label } from './Label'

interface Props {
  rows: SplitRow[]
  accounts: Account[]
  /** Which row's amount the numpad is currently driving, if any. */
  editingId: string | null
  /** Unallocated amount, already formatted. Hidden when the split is exact. */
  remainderText: string | null
  onPickAccount: (rowId: string) => void
  onEditAmount: (rowId: string) => void
  onRemove: (rowId: string) => void
  onAdd: () => void
}

/**
 * The split editor: one (category, amount) row per bucket the purchase falls
 * into, with the unallocated remainder underneath.
 *
 * One physical purchase is often several categories. Recording that as separate
 * transactions misrepresents one payment as three; lumping it under a single
 * category loses the breakdown. This is the third option.
 *
 * A single row is the ordinary case and shows no amount of its own — it simply
 * *is* the hero total (see `syncSingleRow`), so an unsplit purchase costs no
 * extra taps and shows no arithmetic. The amounts only appear once there is
 * something to divide.
 */
export function SplitRows({
  rows,
  accounts,
  editingId,
  remainderText,
  onPickAccount,
  onEditAmount,
  onRemove,
  onAdd,
}: Props) {
  const { accent } = useShellMode()
  const split = rows.length > 1

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Label>{split ? 'Split across' : 'Category'}</Label>
        {remainderText != null && (
          <Text style={styles.remainder} numberOfLines={1}>
            {remainderText}
          </Text>
        )}
      </View>

      {rows.map((row) => {
        const account = accounts.find((a) => a.id === row.accountId)
        const editing = row.id === editingId
        return (
          <View key={row.id} style={styles.row}>
            <Pressable
              style={styles.account}
              onPress={() => {
                haptics.selection()
                onPickAccount(row.id)
              }}
              accessibilityRole="button"
              accessibilityLabel={account ? `Category ${accountLeaf(account)}` : 'Pick a category'}
            >
              <Text
                style={[styles.accountText, account == null && styles.placeholder]}
                numberOfLines={1}
              >
                {account ? accountLeaf(account) : 'Pick a category'}
              </Text>
            </Pressable>

            {/* A lone row carries the hero total, so showing an editable amount
                beside it would just be the same number twice. */}
            {split && (
              <Pressable
                style={[
                  styles.amount,
                  editing && { borderColor: accent.line, backgroundColor: accent.soft },
                ]}
                onPress={() => {
                  haptics.selection()
                  onEditAmount(row.id)
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: editing }}
              >
                <Text style={[styles.amountText, editing && { color: accent.ink }]}>
                  {row.amount === '' ? '0.00' : row.amount}
                </Text>
              </Pressable>
            )}

            {split && (
              <Pressable
                onPress={() => {
                  haptics.selection()
                  onRemove(row.id)
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Remove this split"
              >
                <Ionicons name="close-circle" size={20} color={theme.color.ink3} />
              </Pressable>
            )}
          </View>
        )
      })}

      <Pressable
        style={styles.add}
        onPress={() => {
          haptics.selection()
          onAdd()
        }}
        accessibilityRole="button"
      >
        <Ionicons name="add" size={16} color={accent.accent} />
        <Text style={[styles.addText, { color: accent.accent }]}>Split this</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  remainder: {
    fontFamily: theme.font.monoMedium,
    fontSize: theme.text.xs,
    color: theme.color.ink2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.xs },
  account: {
    flex: 1,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 9,
    borderRadius: theme.radius.field,
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.field,
  },
  accountText: { fontSize: theme.text.sm, color: theme.color.ink },
  placeholder: { color: theme.color.ink3 },
  amount: {
    minWidth: 88,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 9,
    borderRadius: theme.radius.field,
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.field,
    alignItems: 'flex-end',
  },
  amountText: {
    fontFamily: theme.font.monoMedium,
    fontSize: theme.text.sm,
    color: theme.color.ink,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  addText: { fontSize: theme.text.sm, fontWeight: theme.weight.medium },
})
