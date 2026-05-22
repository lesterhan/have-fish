import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import type { GroupInvite } from '@/lib/api'

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
        <TouchableOpacity style={styles.decline} onPress={onDecline}>
          <Text style={styles.declineText}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.accept} onPress={onAccept}>
          <Text style={styles.acceptText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  info: { flex: 1, marginRight: 12 },
  groupName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  meta: { fontSize: 12, color: '#888', marginTop: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  decline: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  declineText: { fontSize: 13, color: '#666' },
  accept: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 5,
    backgroundColor: '#2563eb',
  },
  acceptText: { fontSize: 13, color: '#fff', fontWeight: '600' },
})
