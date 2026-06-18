import { useCallback, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import {
  fetchGroups,
  fetchMyInvites,
  createGroup,
  acceptInvite,
  declineInvite,
  type ExpenseGroup,
  type GroupInvite,
} from '@/lib/api'
import { InviteRow } from '@/components/InviteRow'
import { ScreenHeader } from '@/components/ScreenHeader'
import { Button } from '@/components/Button'
import { theme, cardStyle } from '@/lib/theme'

/**
 * Groups list screen.
 *
 * TODO:
 * - Show outstanding balance summary per group (total owed/owing across all currencies)
 *   by calling fetchBalances() for each group — consider lazy-loading to avoid N+1 on large lists
 * - Add swipe-to-delete on group rows (creator only)
 * - Persist "last visited group" to jump back quickly
 */
export default function GroupsScreen() {
  const router = useRouter()
  const [groups, setGroups] = useState<ExpenseGroup[]>([])
  const [invites, setInvites] = useState<GroupInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const [g, i] = await Promise.all([fetchGroups(), fetchMyInvites()])
      setGroups(g)
      setInvites(i.filter((inv) => inv.status === 'pending'))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true)
      load()
    }, []),
  )

  async function handleAccept(inviteId: string) {
    await acceptInvite(inviteId)
    load()
  }

  async function handleDecline(inviteId: string) {
    await declineInvite(inviteId)
    load()
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return
    setCreating(true)
    try {
      await createGroup(newGroupName.trim())
      setNewGroupName('')
      setCreateModalVisible(false)
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Groups"
        right={
          <TouchableOpacity
            style={styles.newButton}
            onPress={() => setCreateModalVisible(true)}
          >
            <Text style={styles.newButtonText}>+ New</Text>
          </TouchableOpacity>
        }
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {invites.length > 0 && (
        <View style={styles.invitesSection}>
          <Text style={styles.sectionLabel}>Pending invites</Text>
          {invites.map((invite) => (
            <InviteRow
              key={invite.id}
              invite={invite}
              onAccept={() => handleAccept(invite.id)}
              onDecline={() => handleDecline(invite.id)}
            />
          ))}
        </View>
      )}

      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              load()
            }}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.groupRow}
            onPress={() => router.push(`/(app)/groups/${item.id}`)}
          >
            <View>
              <Text style={styles.groupName}>{item.name}</Text>
              <Text style={styles.groupMeta}>
                {item.members.length} member{item.members.length !== 1 ? 's' : ''}
                {item.defaultCurrency ? ` · ${item.defaultCurrency}` : ''}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No groups yet. Create one to get started.</Text>
        }
      />

      {/* Create group modal */}
      <Modal
        visible={createModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New group</Text>
            <TextInput
              style={styles.modalInput}
              value={newGroupName}
              onChangeText={setNewGroupName}
              placeholder="e.g. Tokyo trip"
              autoFocus
            />
            <View style={styles.modalActions}>
              <Button
                title="Cancel"
                variant="neutral"
                size="sm"
                onPress={() => setCreateModalVisible(false)}
              />
              <Button
                title="Create"
                size="sm"
                onPress={handleCreateGroup}
                loading={creating}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.desktop },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.color.desktop,
  },
  newButton: {
    backgroundColor: theme.color.accent,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 7,
    borderRadius: theme.radius.lg,
  },
  newButtonText: {
    color: theme.color.textOnAccent,
    fontWeight: theme.weight.semibold,
    fontSize: theme.text.sm,
  },
  error: { color: theme.color.danger, padding: theme.sp.sm, fontSize: theme.text.sm },
  invitesSection: {
    backgroundColor: theme.color.warningLight,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.warning,
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.xs,
  },
  sectionLabel: {
    fontSize: theme.text.xs,
    fontWeight: theme.weight.semibold,
    color: theme.color.warning,
    marginBottom: 4,
  },
  listContent: { padding: theme.sp.md, gap: theme.sp.xs },
  groupRow: {
    ...cardStyle,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
  },
  groupName: {
    fontSize: theme.text.base,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
  },
  groupMeta: { fontSize: theme.text.xs, color: theme.color.textMuted, marginTop: 2 },
  chevron: { fontSize: theme.text.xl, color: theme.color.textDisabled },
  empty: { padding: theme.sp.lg, color: theme.color.textMuted, textAlign: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: theme.sp.xl,
  },
  modalCard: {
    ...cardStyle,
    padding: theme.sp.lg,
  },
  modalTitle: {
    fontSize: theme.text.lg,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
    marginBottom: theme.sp.sm,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.lg,
    padding: theme.sp.sm,
    fontSize: theme.text.base,
    backgroundColor: theme.color.windowInset,
    marginBottom: theme.sp.md,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.sp.xs },
})
