import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useGroups } from '@/lib/group-context'
import { useShellMode } from '@/lib/shell-mode-context'
import { groupSubtitle } from '@/lib/group-store'
import { theme } from '@/lib/theme'
import { GlossSurface } from './GlossSurface'
import { GroupsSheet } from './GroupsSheet'
import { ModeSwitch } from './ModeSwitch'

/**
 * Persistent shell header. One bar, two faces — which one shows is the shell
 * mode's job (see `lib/shell-mode.ts`).
 *
 * Fish Pie: the active group name in Source Serif with a ▾ that opens the Groups
 * sheet, a "{n} members · {ccy}" sub-line, and a gear routing to group settings.
 *
 * Cash: the personal ledger's own title. No group switcher and no gear — group
 * settings is a Fish Pie concept, and leaving either on screen would suggest the
 * cash wallet belongs to a group. (The wallet name and balance land here in
 * story 3, once wallets exist to name.)
 *
 * Both faces carry the {@link ModeSwitch}, so the current ledger is legible from
 * every screen in the app.
 */
export function AppHeader() {
  const { mode } = useShellMode()

  return (
    <View style={styles.header}>
      {mode === 'pie' ? <PieTitle /> : <CashTitle />}
      <ModeSwitch />
      {mode === 'pie' && <GearButton />}
    </View>
  )
}

function PieTitle() {
  const { group, groups, error } = useGroups()
  const [sheetOpen, setSheetOpen] = useState(false)

  // When the fetch failed and we have no group, the list is empty only because
  // the server was unreachable — say "Offline", not "No groups".
  const title =
    group?.name ?? (error ? 'Offline' : groups.length === 0 ? 'No groups' : 'Loading…')

  return (
    <>
      <Pressable style={styles.left} onPress={() => setSheetOpen(true)} hitSlop={6}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.caret}>▾</Text>
        </View>
        {group != null && <Text style={styles.sub}>{groupSubtitle(group)}</Text>}
      </Pressable>

      <GroupsSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  )
}

function CashTitle() {
  return (
    <View style={styles.left}>
      <Text style={styles.title} numberOfLines={1}>
        Cash
      </Text>
      <Text style={styles.sub}>Your own wallets</Text>
    </View>
  )
}

function GearButton() {
  const router = useRouter()
  return (
    <Pressable
      onPress={() => router.push('/(app)/settings')}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Group settings"
    >
      <GlossSurface radius={theme.radius.md} style={styles.gear}>
        <Ionicons name="settings-outline" size={20} color={theme.color.ink2} />
      </GlossSurface>
    </Pressable>
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
    gap: theme.sp.xs,
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
