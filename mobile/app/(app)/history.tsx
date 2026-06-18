import { useCallback } from 'react'
import { ScrollView, StyleSheet, Text, View, ActivityIndicator } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { ExpenseList } from '@/components/ExpenseList'
import { SettlementList } from '@/components/SettlementList'
import { useGroups } from '@/lib/group-context'
import { theme } from '@/lib/theme'

/**
 * History tab — interim list over the existing expense + settlement lists.
 * Epic 4 rebuilds this as the scannable Companion feed.
 */
export default function HistoryScreen() {
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
      <ExpenseList
        expenses={data.expenses}
        groupId={group.id}
        categories={group.categories}
        onDeleted={reloadData}
        onChanged={reloadData}
      />
      <SettlementList settlements={data.settlements} groupId={group.id} onDeleted={reloadData} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.appBg },
  content: { padding: theme.sp.md, paddingBottom: theme.sp.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.appBg, padding: theme.sp.lg },
  empty: { color: theme.color.ink3, textAlign: 'center' },
})
