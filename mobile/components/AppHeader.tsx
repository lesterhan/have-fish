import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useGroups } from '@/lib/group-context'
import { groupSubtitle } from '@/lib/group-store'
import { theme } from '@/lib/theme'
import { GlossSurface } from './GlossSurface'
import { GroupsSheet } from './GroupsSheet'

/**
 * Persistent shell header (handoff "Header"): the active group name in Source
 * Serif with a ▾ that opens the Groups sheet, a "{n} members · {ccy}" sub-line,
 * and a gear button (gloss) routing to Settings.
 */
export function AppHeader() {
  const router = useRouter()
  const { group, groups, error } = useGroups()
  const [sheetOpen, setSheetOpen] = useState(false)

  // When the fetch failed and we have no group, the list is empty only because
  // the server was unreachable — say "Offline", not "No groups".
  const title =
    group?.name ?? (error ? 'Offline' : groups.length === 0 ? 'No groups' : 'Loading…')

  return (
    <View style={styles.header}>
      <Pressable style={styles.left} onPress={() => setSheetOpen(true)} hitSlop={6}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.caret}>▾</Text>
        </View>
        {group != null && <Text style={styles.sub}>{groupSubtitle(group)}</Text>}
      </Pressable>

      <Pressable onPress={() => router.push('/(app)/settings')} hitSlop={6}>
        <GlossSurface radius={theme.radius.md} style={styles.gear}>
          <Ionicons name="settings-outline" size={20} color={theme.color.ink2} />
        </GlossSurface>
      </Pressable>

      <GroupsSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.chrome,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.line,
    paddingHorizontal: theme.sp.md,
    paddingTop: theme.sp.sm,
    paddingBottom: theme.sp[11],
    gap: theme.sp.sm,
  },
  left: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.xs },
  title: {
    fontFamily: theme.font.serif,
    fontSize: 23,
    fontWeight: theme.weight.semibold,
    letterSpacing: -0.3,
    color: theme.color.ink,
    flexShrink: 1,
  },
  caret: { fontSize: 13, color: theme.color.ink2 },
  sub: { fontFamily: theme.font.mono, fontSize: 10.5, color: theme.color.ink3, marginTop: 2 },
  gear: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
})
