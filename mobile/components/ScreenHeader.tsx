import type { ReactNode } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { theme } from '@/lib/theme'

interface Props {
  title: string
  /** When provided, renders a back affordance and centers the title (detail-screen mode). */
  onBack?: () => void
  /** Optional right-side action (e.g. a "+ New" button). */
  right?: ReactNode
}

/**
 * Shared screen header — the Graphite chrome at the top of every screen.
 *
 * Two modes, both used across the app:
 * - **Top-level** (no `onBack`): title left-aligned, optional `right` action.
 *   Used by Groups list and Settings.
 * - **Detail** (`onBack` set): back chevron left, title centered, `right` action.
 *   Used by the group detail screen.
 *
 * Top padding comes from the device safe-area inset, so the header clears the
 * status bar / notch on any device instead of a magic constant.
 */
export function ScreenHeader({ title, onBack, right }: Props) {
  const insets = useSafeAreaInsets()
  const centered = onBack != null

  return (
    <View style={[styles.header, { paddingTop: insets.top + theme.sp.xs }]}>
      {onBack && (
        <TouchableOpacity onPress={onBack} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
      )}

      <Text
        style={[styles.title, centered && styles.titleCentered]}
        numberOfLines={1}
      >
        {title}
      </Text>

      {/* Right slot — fixed width when centered so the title stays optically centered. */}
      <View style={centered ? styles.rightCentered : styles.right}>{right}</View>
    </View>
  )
}

const SIDE_WIDTH = 72

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.md,
    paddingBottom: theme.sp.sm,
    backgroundColor: theme.color.window,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.rule,
  },
  back: { width: SIDE_WIDTH },
  backText: { fontSize: theme.text.base, color: theme.color.accent },
  title: {
    fontSize: theme.text.xl,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
  },
  titleCentered: {
    flex: 1,
    textAlign: 'center',
    fontSize: theme.text.lg,
  },
  right: { marginLeft: theme.sp.sm },
  rightCentered: { width: SIDE_WIDTH, alignItems: 'flex-end' },
})
