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
      <View style={styles.header}>
        <Text style={styles.title}>Groups</Text>
        <TouchableOpacity
          style={styles.newButton}
          onPress={() => setCreateModalVisible(true)}
        >
          <Text style={styles.newButtonText}>+ New</Text>
        </TouchableOpacity>
      </View>

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
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setCreateModalVisible(false)}
              >
                <Text>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCreate}
                onPress={handleCreateGroup}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalCreateText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  newButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
  },
  newButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  error: { color: '#c0392b', padding: 12, fontSize: 13 },
  invitesSection: {
    backgroundColor: '#fffbeb',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#92400e', marginBottom: 4 },
  groupRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  groupName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  groupMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  chevron: { fontSize: 20, color: '#bbb' },
  empty: { padding: 24, color: '#888', textAlign: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 32,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 10,
    fontSize: 15,
    marginBottom: 16,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  modalCancel: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  modalCreate: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
  },
  modalCreateText: { color: '#fff', fontWeight: '600' },
})
