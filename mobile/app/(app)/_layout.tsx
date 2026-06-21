import { View, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Tabs } from 'expo-router'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { GroupProvider } from '@/lib/group-context'
import { AppHeader } from '@/components/AppHeader'
import { theme } from '@/lib/theme'

/**
 * Authenticated shell (Companion). The group is the shell, not a pushed detail
 * screen: a persistent header (group switcher + gear) sits above a 4-tab bar
 * (Add / Balances / History / Account). Group settings is reached from the gear,
 * not a tab; the Account tab holds app/device settings.
 */
export default function AppLayout() {
  return (
    <GroupProvider>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <AppHeader />
        <View style={styles.body}>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: theme.color.accent,
              tabBarInactiveTintColor: theme.color.ink3,
              tabBarStyle: {
                backgroundColor: theme.color.chrome,
                borderTopWidth: 1,
                borderTopColor: theme.color.line,
              },
              tabBarLabelStyle: { fontSize: 11 },
            }}
          >
            <Tabs.Screen
              name="index"
              options={{
                title: 'Add',
                tabBarIcon: ({ color }) => <Ionicons name="add" size={22} color={color} />,
              }}
            />
            <Tabs.Screen
              name="balances"
              options={{
                title: 'Balances',
                tabBarIcon: ({ color }) => (
                  <MaterialCommunityIcons name="scale-balance" size={22} color={color} />
                ),
              }}
            />
            <Tabs.Screen
              name="history"
              options={{
                title: 'History',
                tabBarIcon: ({ color }) => <Ionicons name="list" size={22} color={color} />,
              }}
            />
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
            {/* Legacy deep-link screen — removed in Epic 4. */}
            <Tabs.Screen name="groups/[id]" options={{ href: null }} />
          </Tabs>
        </View>
      </SafeAreaView>
    </GroupProvider>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.chrome },
  body: { flex: 1, backgroundColor: theme.color.appBg },
})
