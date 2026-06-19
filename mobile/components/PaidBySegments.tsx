import { StyleSheet, Text, View, Pressable } from 'react-native'
import type { ExpenseGroup } from '@/lib/api'
import { memberSharePct } from '@/lib/group-entry'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { Avatar } from './Avatar'
import { GlossLayers } from './GlossLayers'

interface Props {
  group: ExpenseGroup
  /** Currently selected payer's userId. */
  paidByUserId: string
  onSelect: (userId: string) => void
}

/**
 * Paid-by control — one selectable segment per member (avatar, name, read-only
 * `{pct}% share`). Single-select; the chosen payer drives which member's default
 * payment account the expense posts from (resolved in Story 5).
 *
 * The design assumes two members and renders two equal segments. It degrades
 * safely: one member → a single full-width segment; three or more → a wrapping
 * row (rare on mobile, but must not crash).
 */
export function PaidBySegments({ group, paidByUserId, onSelect }: Props) {
  return (
    <View style={styles.row}>
      {group.members.map((m) => {
        const selected = m.userId === paidByUserId
        return (
          <Pressable
            key={m.userId}
            style={[styles.segment, selected ? styles.segmentOn : styles.segmentOff]}
            onPress={() => onSelect(m.userId)}
            onPressIn={haptics.selection}
          >
            {selected && <GlossLayers base={theme.color.accentSoft} radius={theme.radius.field} />}
            <Avatar name={m.userName} size={30} selected={selected} />
            <View style={styles.text}>
              <Text style={[styles.name, selected && styles.nameOn]} numberOfLines={1}>
                {m.userName}
              </Text>
              <Text style={styles.share} numberOfLines={1}>
                {memberSharePct(group, m.userId)}% share
              </Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.sp.sm,
  },
  segment: {
    flexGrow: 1,
    flexBasis: 150,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp[10],
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: theme.radius.field,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  segmentOn: { borderColor: theme.color.accentLine, backgroundColor: theme.color.accentSoft },
  segmentOff: { borderColor: theme.color.line, backgroundColor: theme.color.field },
  text: { flexShrink: 1 },
  name: {
    fontFamily: theme.font.sans,
    fontSize: 14,
    fontWeight: theme.weight.bold,
    color: theme.color.ink,
  },
  nameOn: { color: theme.color.accentInk },
  share: {
    fontFamily: theme.font.mono,
    fontSize: 10.5,
    color: theme.color.ink3,
  },
})
