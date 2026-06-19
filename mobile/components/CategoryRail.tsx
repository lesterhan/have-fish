import { ScrollView, StyleSheet } from 'react-native'
import type { GroupCategory } from '@/lib/api'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { Chip } from './Chip'

interface Props {
  /** Active categories in display order (already filtered/sorted by the caller). */
  categories: GroupCategory[]
  /** Selected category id, or null for uncategorized. */
  selectedId: string | null
  /** Receives the new selection; null when the selected chip is tapped to clear. */
  onSelect: (id: string | null) => void
}

/**
 * Category rail — a single horizontal-scroll row of read-only category chips
 * (categories are managed on the web app). The rail bleeds to the screen edges
 * so chips scroll under the edge rather than wrapping. Tapping the selected chip
 * clears it (uncategorized).
 */
export function CategoryRail({ categories, selectedId, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.rail}
      contentContainerStyle={styles.content}
    >
      {categories.map((c) => {
        const active = c.id === selectedId
        return (
          <Chip
            key={c.id}
            label={c.name}
            active={active}
            mono={false}
            onPress={() => {
              haptics.selection()
              onSelect(active ? null : c.id)
            }}
          />
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  // Bleed past the column's horizontal padding so chips scroll under the edge.
  rail: { marginHorizontal: -theme.sp.md },
  content: {
    flexDirection: 'row',
    gap: theme.sp.sm,
    paddingHorizontal: theme.sp.md,
    paddingBottom: 2,
  },
})
