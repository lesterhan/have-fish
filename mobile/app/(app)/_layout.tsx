import { Tabs } from 'expo-router'
import { Text } from 'react-native'
import { theme } from '@/lib/theme'

/**
 * Bottom tab navigator for the authenticated app shell.
 * Tabs: Groups (home), Settings.
 *
 * TODO: Add a pending-invites badge on the Groups tab using a count from
 * fetchMyInvites(). Fetch count on mount and re-fetch on app foreground.
 */
export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.accent,
        tabBarInactiveTintColor: theme.color.textMuted,
        tabBarStyle: {
          backgroundColor: theme.color.window,
          borderTopWidth: 1,
          borderTopColor: theme.color.rule,
        },
        tabBarLabelStyle: { fontSize: theme.text.xs },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>⚖️</Text>,
        }}
      />
      <Tabs.Screen
        name="groups/[id]"
        options={{
          href: null, // hidden from tab bar — navigated to by pressing a group row
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>⚙️</Text>,
        }}
      />
    </Tabs>
  )
}
