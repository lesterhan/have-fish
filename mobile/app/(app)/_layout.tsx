import { Tabs } from 'expo-router'
import { Text } from 'react-native'

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
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#888',
        tabBarStyle: { borderTopWidth: 1, borderTopColor: '#e0e0e0' },
        tabBarLabelStyle: { fontSize: 11 },
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
