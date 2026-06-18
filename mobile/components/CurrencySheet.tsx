import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { currencyFlag, orderByRecent, topRecents } from '@/lib/currency'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { BottomSheet } from './BottomSheet'
import { GlossButton } from './GlossButton'
import { GlossSurface } from './GlossSurface'

interface Props {
  visible: boolean
  /** Currently active currency code, highlighted in the grid. */
  selected: string
  /** Stored recent-currency list (most-recent-first), for ordering. */
  recents: string[]
  onSelect: (code: string) => void
  onClose: () => void
}

const COLUMNS = 3

/** Chunk a list into fixed-width rows, padding the last with `null` spacers so a
 * lone trailing tile keeps its 1/N column width instead of stretching. */
function intoRows(items: string[], size: number): (string | null)[][] {
  const rows: (string | null)[][] = []
  for (let i = 0; i < items.length; i += size) {
    const row: (string | null)[] = items.slice(i, i + size)
    while (row.length < size) row.push(null)
    rows.push(row)
  }
  return rows
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
        {intoRows(codes, COLUMNS).map((row, i) => (
          <View key={i} style={styles.row}>
            {row.map((code, j) =>
              code == null ? (
                <View key={`spacer-${j}`} style={styles.tileSlot} />
              ) : (
                <Pressable
                  key={code}
                  style={styles.tileSlot}
                  onPress={() => pick(code)}
                  onPressIn={haptics.selection}
                >
                  <GlossSurface
                    base={code === selected ? theme.color.accentSoft : theme.color.surface2}
                    radius={theme.radius.field}
                    style={styles.tile}
                  >
                    <Text style={styles.flag}>{currencyFlag(code)}</Text>
                    <Text style={[styles.code, code === selected && styles.codeSelected]}>
                      {code}
                    </Text>
                  </GlossSurface>
                </Pressable>
              ),
            )}
          </View>
        ))}
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
  row: { flexDirection: 'row', gap: theme.sp[9] },
  tileSlot: { flex: 1 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: theme.sp.sm,
  },
  flag: { fontSize: 16 },
  code: {
    fontFamily: theme.font.monoBold,
    fontSize: 15,
    color: theme.color.ink,
  },
  codeSelected: { color: theme.color.accentInk },
  more: { marginTop: theme.sp[9] },
})
