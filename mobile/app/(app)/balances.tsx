import { useCallback } from 'react'
import { ScrollView, StyleSheet, Text, View, ActivityIndicator } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { BalanceCard } from '@/components/BalanceCard'
import { useGroups } from '@/lib/group-context'
import { theme } from '@/lib/theme'

/**
 * Balances tab — interim view over the existing balance card. Epic 3 rebuilds
 * this as per-currency gloss cards with settlement.
 */
export default function BalancesScreen() {
  const { group, data, loadingGroups, reloadData } = useGroups()

  useFocusEffect(
    useCallback(() => {
      reloadData()
    }, [reloadData]),
  )

  if (loadingGroups && !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    )
  }

  if (!group) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No group selected.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <BalanceCard balances={data.balances} members={group.members} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.appBg },
  content: { padding: theme.sp.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.appBg, padding: theme.sp.lg },
  empty: { color: theme.color.ink3, textAlign: 'center' },
})
