import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import {
  updateGroup,
  updateMemberWeight,
  sendInvite,
  cancelInvite,
  deleteGroup,
  type ExpenseGroup,
  type GroupInvite,
} from '@/lib/api'
import { Button } from './Button'
import { theme, cardStyle } from '@/lib/theme'

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

        <Button
          title="Save changes"
          size="sm"
          onPress={handleSaveName}
          loading={savingName}
          style={styles.saveButton}
        />
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
          <Button
            title="Send"
            size="sm"
            onPress={handleSendInvite}
            loading={sendingInvite}
            style={styles.inviteButton}
          />
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
        <Button title="Delete group" variant="danger" onPress={handleDeleteGroup} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: theme.sp.sm },
  section: {
    ...cardStyle,
    padding: theme.sp.md,
    gap: theme.sp.xs,
  },
  sectionLabel: {
    fontSize: theme.text.xs,
    fontWeight: theme.weight.semibold,
    color: theme.color.textMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  label: {
    fontSize: theme.text.sm,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.lg,
    padding: theme.sp.sm,
    fontSize: theme.text.sm,
    backgroundColor: theme.color.windowInset,
  },
  saveButton: { marginTop: 4 },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  memberInfo: { flex: 1 },
  memberName: {
    fontSize: theme.text.sm,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
  },
  memberEmail: { fontSize: theme.text.xs, color: theme.color.textMuted },
  weightControl: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.xs },
  weightButton: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.windowInset,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weightButtonText: { fontSize: theme.text.base, color: theme.color.text, lineHeight: 20 },
  weightValue: {
    fontSize: theme.text.base,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
    minWidth: 24,
    textAlign: 'center',
  },
  inviteRow: { flexDirection: 'row', gap: theme.sp.xs, alignItems: 'stretch' },
  inviteInput: { flex: 1 },
  inviteButton: { justifyContent: 'center' },
  pendingInvites: { marginTop: theme.sp.xs },
  pendingLabel: {
    fontSize: theme.text.xs,
    fontWeight: theme.weight.semibold,
    color: theme.color.textMuted,
    marginBottom: 4,
  },
  pendingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  pendingEmail: { fontSize: theme.text.sm, color: theme.color.text },
  cancelInviteText: { fontSize: theme.text.sm, color: theme.color.danger },
  error: { color: theme.color.danger, fontSize: theme.text.sm },
  danger: { borderColor: theme.color.danger },
})
