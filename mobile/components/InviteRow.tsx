import { View, Text, StyleSheet } from 'react-native'
import type { GroupInvite } from '@/lib/api'
import { Button } from './Button'
import { theme } from '@/lib/theme'

interface Props {
  invite: GroupInvite
  onAccept: () => void
  onDecline: () => void
}

export function InviteRow({ invite, onAccept, onDecline }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.info}>
        <Text style={styles.groupName}>{invite.groupName ?? 'Group invite'}</Text>
        {invite.inviterName && (
          <Text style={styles.meta}>from {invite.inviterName}</Text>
        )}
      </View>
      <View style={styles.actions}>
        <Button title="Decline" variant="neutral" size="sm" onPress={onDecline} />
        <Button title="Accept" variant="primary" size="sm" onPress={onAccept} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.sp.xs,
  },
  info: { flex: 1, marginRight: theme.sp.sm },
  groupName: {
    fontSize: theme.text.sm,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
  },
  meta: { fontSize: theme.text.xs, color: theme.color.textMuted, marginTop: 1 },
  actions: { flexDirection: 'row', gap: theme.sp.xs },
})
