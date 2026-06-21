import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { createGroup } from '@/lib/api'
import { useGroups } from '@/lib/group-context'
import { groupSubtitle } from '@/lib/group-store'
import { theme } from '@/lib/theme'
import { BottomSheet } from './BottomSheet'
import { GlossSurface } from './GlossSurface'
import { GlossButton } from './GlossButton'
import { Avatar } from './Avatar'

interface Props {
  visible: boolean
  onClose: () => void
}

/**
 * Groups sheet — the group switcher reached from the header. Lists the user's
 * groups with a "{n} members · {ccy}" sub-line, switches + persists the active
 * group on tap, and offers a minimal inline create.
 */
export function GroupsSheet({ visible, onClose }: Props) {
  const { groups, activeGroupId, setActiveGroup, reloadGroups } = useGroups()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pick(id: string) {
    setActiveGroup(id)
    onClose()
  }

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const created = await createGroup(trimmed)
      setName('')
      setCreating(false)
      await reloadGroups()
      if (created?.id) pick(created.id)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create group')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Groups">
      <View style={styles.list}>
        {groups.map((g) => {
          const active = g.id === activeGroupId
          return (
            <Pressable key={g.id} onPress={() => pick(g.id)}>
              <GlossSurface
                base={active ? theme.color.accentSoft : theme.color.surface2}
                radius={theme.radius.cardSm}
                style={styles.row}
              >
                <Avatar name={g.name} size={32} selected={active} />
                <View style={styles.rowText}>
                  <Text style={[styles.name, active && styles.nameActive]} numberOfLines={1}>
                    {g.name}
                  </Text>
                  <Text style={styles.sub}>{groupSubtitle(g)}</Text>
                </View>
                {active && <Text style={styles.check}>✓</Text>}
              </GlossSurface>
            </Pressable>
          )
        })}

        {groups.length === 0 && <Text style={styles.empty}>No groups yet.</Text>}
      </View>

      {error != null && <Text style={styles.error}>{error}</Text>}

      {creating ? (
        <View style={styles.createRow}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Tokyo trip"
            placeholderTextColor={theme.color.ink3}
            autoFocus
            editable={!busy}
          />
          {busy ? (
            <ActivityIndicator />
          ) : (
            <GlossButton label="Create" onPress={handleCreate} height={44} style={styles.createBtn} />
          )}
        </View>
      ) : (
        <GlossButton
          label="+ New group"
          variant="neutral"
          onPress={() => setCreating(true)}
          height={46}
          style={styles.newBtn}
        />
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  list: { gap: theme.sp[9] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: theme.sp[11],
  },
  rowText: { flex: 1 },
  name: { fontFamily: theme.font.sans, fontSize: 15, fontWeight: theme.weight.semibold, color: theme.color.ink },
  nameActive: { color: theme.color.accentInk },
  sub: { fontFamily: theme.font.mono, fontSize: 11, color: theme.color.ink3, marginTop: 2 },
  check: { fontSize: 16, color: theme.color.accentInk, fontWeight: theme.weight.bold },
  empty: { color: theme.color.ink3, textAlign: 'center', paddingVertical: theme.sp.md },
  error: { color: theme.color.red, fontSize: theme.text.sm, marginTop: theme.sp.xs },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.xs, marginTop: theme.sp.sm },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.color.line,
    borderRadius: theme.radius.field,
    paddingHorizontal: theme.sp.sm,
    height: 44,
    fontSize: theme.text.base,
    color: theme.color.ink,
    backgroundColor: theme.color.field,
  },
  createBtn: { paddingHorizontal: theme.sp.md },
  newBtn: { marginTop: theme.sp.sm },
})
