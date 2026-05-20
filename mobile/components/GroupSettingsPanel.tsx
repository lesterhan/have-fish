import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native'
import {
  updateGroup,
  updateMemberWeight,
  sendInvite,
  cancelInvite,
  deleteGroup,
  type ExpenseGroup,
  type GroupInvite,
} from '@/lib/api'

interface Props {
  group: ExpenseGroup
  invites: GroupInvite[]
  onGroupUpdated: () => void
  onGroupDeleted: () => void
}

/**
 * Group settings panel — Tab 4 on the group detail screen.
 *
 * TODO:
 * - Gate name editing and delete to group.createdBy === currentUserId
 * - Add a currency picker (bottom sheet with common ISO 4217 codes)
 * - Show share weight as a fraction label (e.g. "2 / 3 of expenses") rather
 *   than a raw integer
 */
export function GroupSettingsPanel({ group, invites, onGroupUpdated, onGroupDeleted }: Props) {
  const [name, setName] = useState(group.name)
  const [currency, setCurrency] = useState(group.defaultCurrency ?? '')
  const [inviteEmail, setInviteEmail] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [sendingInvite, setSendingInvite] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSaveName() {
    setSavingName(true)
    try {
      await updateGroup(group.id, {
        name: name.trim(),
        defaultCurrency: currency.trim() || null,
      })
      onGroupUpdated()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSavingName(false)
    }
  }

  async function handleSendInvite() {
    if (!inviteEmail.trim()) return
    setSendingInvite(true)
    setError(null)
    try {
      await sendInvite(group.id, inviteEmail.trim())
      setInviteEmail('')
      onGroupUpdated()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSendingInvite(false)
    }
  }

  async function handleCancelInvite(inviteId: string) {
    await cancelInvite(group.id, inviteId)
    onGroupUpdated()
  }

  async function handleUpdateWeight(userId: string, current: number, delta: number) {
    const next = Math.max(1, current + delta)
    await updateMemberWeight(group.id, userId, next)
    onGroupUpdated()
  }

  function handleDeleteGroup() {
    Alert.alert(
      'Delete group',
      `Delete "${group.name}" and all its expenses? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteGroup(group.id)
            onGroupDeleted()
          },
        },
      ],
    )
  }

  return (
    <View style={styles.container}>
      {/* Group name + currency */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Group</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} />

        <Text style={styles.label}>Default currency</Text>
        <TextInput
          style={styles.input}
          value={currency}
          onChangeText={setCurrency}
          placeholder="CAD"
          autoCapitalize="characters"
          maxLength={3}
        />

        <TouchableOpacity style={styles.saveButton} onPress={handleSaveName} disabled={savingName}>
          {savingName ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveText}>Save changes</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Members & share weights */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Members</Text>
        {group.members.map((m) => (
          <View key={m.userId} style={styles.memberRow}>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{m.userName}</Text>
              <Text style={styles.memberEmail}>{m.userEmail}</Text>
            </View>
            <View style={styles.weightControl}>
              <TouchableOpacity
                style={styles.weightButton}
                onPress={() => handleUpdateWeight(m.userId, m.shareWeight, -1)}
              >
                <Text style={styles.weightButtonText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.weightValue}>{m.shareWeight}</Text>
              <TouchableOpacity
                style={styles.weightButton}
                onPress={() => handleUpdateWeight(m.userId, m.shareWeight, 1)}
              >
                <Text style={styles.weightButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* Invitations */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Invite</Text>
        <View style={styles.inviteRow}>
          <TextInput
            style={[styles.input, styles.inviteInput]}
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="email@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={styles.inviteButton}
            onPress={handleSendInvite}
            disabled={sendingInvite}
          >
            {sendingInvite ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.inviteButtonText}>Send</Text>
            )}
          </TouchableOpacity>
        </View>

        {invites.length > 0 && (
          <View style={styles.pendingInvites}>
            <Text style={styles.pendingLabel}>Pending</Text>
            {invites.map((inv) => (
              <View key={inv.id} style={styles.pendingRow}>
                <Text style={styles.pendingEmail}>{inv.inviteeEmail}</Text>
                <TouchableOpacity onPress={() => handleCancelInvite(inv.id)}>
                  <Text style={styles.cancelInviteText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Danger zone */}
      <View style={[styles.section, styles.danger]}>
        <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteGroup}>
          <Text style={styles.deleteText}>Delete group</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    padding: 16,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    backgroundColor: '#fafafa',
  },
  saveButton: {
    backgroundColor: '#2563eb',
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  saveText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  memberEmail: { fontSize: 12, color: '#888' },
  weightControl: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weightButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weightButtonText: { fontSize: 16, color: '#444', lineHeight: 20 },
  weightValue: { fontSize: 15, fontWeight: '700', minWidth: 24, textAlign: 'center' },
  inviteRow: { flexDirection: 'row', gap: 8 },
  inviteInput: { flex: 1 },
  inviteButton: {
    backgroundColor: '#2563eb',
    borderRadius: 6,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  inviteButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  pendingInvites: { marginTop: 8 },
  pendingLabel: { fontSize: 11, fontWeight: '700', color: '#888', marginBottom: 4 },
  pendingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  pendingEmail: { fontSize: 13, color: '#444' },
  cancelInviteText: { fontSize: 13, color: '#e74c3c' },
  error: { color: '#e74c3c', fontSize: 13 },
  danger: { borderColor: '#fca5a5' },
  deleteButton: {
    padding: 10,
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  deleteText: { color: '#e74c3c', fontWeight: '600', fontSize: 14 },
})
