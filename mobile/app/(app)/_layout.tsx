import { View, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Tabs } from 'expo-router'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { GroupProvider } from '@/lib/group-context'
import { ShellModeProvider, useShellMode } from '@/lib/shell-mode-context'
import { tabHref } from '@/lib/shell-mode'
import { AppHeader } from '@/components/AppHeader'
import { theme } from '@/lib/theme'

/**
 * Authenticated shell (Companion). Two ledgers live here — Fish Pie (shared
 * group expenses) and Cash (the user's own wallets) — and the shell keeps them
 * visibly apart, because a spend entered in the wrong one is silently wrong.
 *
 * A persistent header (title + the Group|Cash switch, plus the group switcher
 * and gear in Fish Pie) sits above one tab bar whose contents depend on the
 * mode:
 *
 *   Fish Pie  Add · Balances · History · Account
 *   Cash      Spend · Wallets · Cash history · Account
 *
 * Every screen is registered on the single navigator and the inactive mode's
 * tabs are hidden with `href: null`. One navigator rather than two nested ones
 * keeps each mode's screens mounted across a switch — no remount, no lost
 * scroll position, and no duplicated Account route. Group settings stays off the
 * bar, reached from the header gear.
 */
export default function AppLayout() {
  return (
    <ShellModeProvider>
      <GroupProvider>
        <SafeAreaView edges={['top']} style={styles.safe}>
          <AppHeader />
          <View style={styles.body}>
            <ShellTabs />
          </View>
        </SafeAreaView>
      </GroupProvider>
    </ShellModeProvider>
  )
}

function ShellTabs() {
  const { mode, accent } = useShellMode()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // The active tint is the mode's accent, so the tab bar carries the same
        // which-ledger-am-I-in cue as the header switch.
        tabBarActiveTintColor: accent.accent,
        tabBarInactiveTintColor: theme.color.ink3,
        tabBarStyle: {
          backgroundColor: theme.color.chrome,
          borderTopWidth: 1,
          borderTopColor: theme.color.line,
        },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      {/* ── Fish Pie ─────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Add',
          href: tabHref('pie', mode),
          tabBarIcon: ({ color }) => <Ionicons name="add" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="balances"
        options={{
          title: 'Balances',
          href: tabHref('pie', mode),
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="scale-balance" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          href: tabHref('pie', mode),
          tabBarIcon: ({ color }) => <Ionicons name="list" size={22} color={color} />,
        }}
      />

      {/* ── Cash ─────────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="cash-spend"
        options={{
          title: 'Spend',
          href: tabHref('cash', mode),
          tabBarIcon: ({ color }) => <Ionicons name="cash-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="cash-wallets"
        options={{
          title: 'Wallets',
          href: tabHref('cash', mode),
          tabBarIcon: ({ color }) => (
            <Ionicons name="wallet-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cash-history"
        options={{
          title: 'History',
          href: tabHref('cash', mode),
          tabBarIcon: ({ color }) => <Ionicons name="list" size={22} color={color} />,
        }}
      />

      {/* ── Shared ───────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color }) => (
            <Ionicons name="person-circle-outline" size={23} color={color} />
          ),
        }}
      />
      {/* Group settings — reached from the header gear, not the tab bar. */}
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.chrome },
  body: { flex: 1, backgroundColor: theme.color.appBg },
})
