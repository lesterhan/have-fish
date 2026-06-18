import { useCallback, type ReactNode } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useGroups, type GroupData } from '@/lib/group-context'
import type { ExpenseGroup } from '@/lib/api'
import { theme } from '@/lib/theme'

interface RenderArgs {
  group: ExpenseGroup
  data: GroupData
  reloadData: () => Promise<void>
}

interface Props {
  /** Re-fetch the active group's data each time the tab gains focus. */
  refreshOnFocus?: boolean
  contentStyle?: StyleProp<ViewStyle>
  /** Rendered only once a group is resolved — `group` is guaranteed non-null. */
  children: (args: RenderArgs) => ReactNode
}

/**
 * Shared scaffold for the three group tabs (Add / Balances / History): it
 * resolves the active group from context, shows the loading / no-group states,
 * optionally refreshes on focus, and wraps the content in a padded ScrollView.
 * Tab screens only describe their own content via the render prop.
 */
export function GroupScreen({ refreshOnFocus = false, contentStyle, children }: Props) {
  const { group, data, loadingGroups, reloadData } = useGroups()

  useFocusEffect(
    useCallback(() => {
      if (refreshOnFocus) reloadData()
    }, [refreshOnFocus, reloadData]),
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
        <Text style={styles.empty}>No group selected. Create one from the header.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={[styles.content, contentStyle]}>
      {children({ group, data, reloadData })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.appBg },
  content: { padding: theme.sp.md },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.appBg,
    padding: theme.sp.lg,
  },
  empty: { color: theme.color.ink3, textAlign: 'center' },
})
