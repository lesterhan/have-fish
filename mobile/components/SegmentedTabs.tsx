import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { theme } from '@/lib/theme'

interface Props<T extends string> {
  tabs: readonly T[]
  active: T
  onChange: (tab: T) => void
  /** Optional display labels; defaults to capitalizing each tab key. */
  labels?: Partial<Record<T, string>>
}

/**
 * Underline segmented tab bar — the in-screen tab control from the group detail
 * screen, extracted for reuse. Active tab gets an accent underline + accent text.
 */
export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
  labels,
}: Props<T>) {
  return (
    <View style={styles.bar}>
      {tabs.map((tab) => {
        const isActive = tab === active
        const label = labels?.[tab] ?? tab.charAt(0).toUpperCase() + tab.slice(1)
        return (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onChange(tab)}
          >
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: theme.color.window,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.rule,
  },
  tab: {
    flex: 1,
    paddingVertical: theme.sp.xs,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: theme.color.accent },
  tabText: { fontSize: theme.text.sm, color: theme.color.textMuted },
  tabTextActive: { color: theme.color.accent, fontWeight: theme.weight.semibold },
})
