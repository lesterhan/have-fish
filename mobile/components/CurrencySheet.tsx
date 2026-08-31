import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import { orderByRecent, topRecents } from '@/lib/currency'
import { theme } from '@/lib/theme'
import { BottomSheet } from './BottomSheet'
import { CurrencyGrid } from './CurrencyGrid'
import { GlossButton } from './GlossButton'

interface Props {
  visible: boolean
  /** Currently active currency code, highlighted in the grid. */
  selected: string
  /** Stored recent-currency list (most-recent-first), for ordering. */
  recents: string[]
  onSelect: (code: string) => void
  onClose: () => void
}

/**
 * Currency sheet — a two-step picker reached from the amount pill.
 *
 * - **Step 1** (default): the most recently used currencies (current selection
 *   floated first) as flag + code tiles, plus a "More currencies" button.
 * - **Step 2**: the full catalogue, recents floated to the top, scrollable.
 *
 * Tapping any tile sets the currency and closes. Reopening always starts at
 * step 1.
 */
export function CurrencySheet({ visible, selected, recents, onSelect, onClose }: Props) {
  const [expanded, setExpanded] = useState(false)

  // Always reopen on the compact step.
  useEffect(() => {
    if (visible) setExpanded(false)
  }, [visible])

  function pick(code: string) {
    onSelect(code)
    onClose()
  }

  const codes = expanded ? orderByRecent(recents) : topRecents(selected, recents)

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Currency">
      <ScrollView
        style={expanded && styles.scroll}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
      >
        <CurrencyGrid codes={codes} selected={selected} onSelect={pick} />
      </ScrollView>

      {!expanded && (
        <GlossButton
          label="More currencies ▾"
          variant="neutral"
          height={44}
          onPress={() => setExpanded(true)}
          style={styles.more}
        />
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  // Cap the expanded list so the sheet stays a sheet (not full-screen).
  scroll: { maxHeight: 320 },
  grid: { gap: theme.sp[9] },
  more: { marginTop: theme.sp[9] },
})
