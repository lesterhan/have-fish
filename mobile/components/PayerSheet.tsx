import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { ExpenseGroup } from '@/lib/api'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { Avatar } from './Avatar'
import { BottomSheet } from './BottomSheet'

interface Props {
  visible: boolean
  group: ExpenseGroup
  /** Currently selected payer's userId. */
  paidByUserId: string
  onSelect: (userId: string) => void
  onClose: () => void
}

/**
 * Payer picker for 3+ member groups — a simple member list in a {@link BottomSheet}.
 * Two-member groups never reach here (the payer chip flips inline); this is the
 * fallback when an instant flip is ambiguous.
 */
export function PayerSheet({ visible, group, paidByUserId, onSelect, onClose }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Paid by">
      <View>
        {group.members.map((m) => {
          const selected = m.userId === paidByUserId
          return (
            <Pressable
              key={m.userId}
              style={styles.row}
              onPress={() => {
                onSelect(m.userId)
                onClose()
              }}
              onPressIn={haptics.selection}
            >
              <Avatar name={m.userName} size={32} selected={selected} />
              <Text style={[styles.name, selected && styles.nameOn]} numberOfLines={1}>
                {m.userName}
              </Text>
              {selected ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          )
        })}
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.xs,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.lineSoft,
  },
  name: {
    flex: 1,
    fontFamily: theme.font.sans,
    fontSize: theme.text.base,
    fontWeight: theme.weight.medium,
    color: theme.color.ink,
  },
  nameOn: { color: theme.color.accentInk },
  check: { fontSize: theme.text.base, color: theme.color.accent, marginLeft: theme.sp.xs },
})
