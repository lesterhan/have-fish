import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ALL_CURRENCIES, currencySymbol } from '@/lib/currency'
import { theme } from '@/lib/theme'
import { BottomSheet } from './BottomSheet'
import { GlossSurface } from './GlossSurface'

interface Props {
  visible: boolean
  /** Currently active currency code, highlighted in the grid. */
  selected: string
  onSelect: (code: string) => void
  onClose: () => void
}

const COLUMNS = 3

/** Chunk the catalogue into fixed-width rows, padding the last with spacers so
 * a lone trailing tile keeps its 1/N column width instead of stretching. */
function intoRows<T>(items: readonly T[], size: number): (T | null)[][] {
  const rows: (T | null)[][] = []
  for (let i = 0; i < items.length; i += size) {
    const row: (T | null)[] = items.slice(i, i + size)
    while (row.length < size) row.push(null)
    rows.push(row)
  }
  return rows
}

/**
 * Currency sheet — the full-catalogue picker reached from the amount pill or the
 * `···` quick chip. A 3-column grid of `{code}` + `{symbol}` tiles; tapping one
 * sets the currency and closes the sheet.
 */
export function CurrencySheet({ visible, selected, onSelect, onClose }: Props) {
  function pick(code: string) {
    onSelect(code)
    onClose()
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Currency">
      <View style={styles.grid}>
        {intoRows(ALL_CURRENCIES, COLUMNS).map((row, i) => (
          <View key={i} style={styles.row}>
            {row.map((code, j) =>
              code == null ? (
                <View key={`spacer-${j}`} style={styles.tileSlot} />
              ) : (
                <Pressable key={code} style={styles.tileSlot} onPress={() => pick(code)}>
                  <GlossSurface
                    base={code === selected ? theme.color.accentSoft : theme.color.surface2}
                    radius={theme.radius.field}
                    style={styles.tile}
                  >
                    <Text style={[styles.code, code === selected && styles.codeSelected]}>
                      {code}
                    </Text>
                    <Text style={[styles.symbol, code === selected && styles.symbolSelected]}>
                      {currencySymbol(code)}
                    </Text>
                  </GlossSurface>
                </Pressable>
              ),
            )}
          </View>
        ))}
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  grid: { gap: theme.sp[9] },
  row: { flexDirection: 'row', gap: theme.sp[9] },
  tileSlot: { flex: 1 },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.sp.sm,
    gap: 2,
  },
  code: {
    fontFamily: theme.font.monoBold,
    fontSize: 15,
    color: theme.color.ink,
  },
  codeSelected: { color: theme.color.accentInk },
  symbol: {
    fontFamily: theme.font.mono,
    fontSize: 13,
    color: theme.color.ink3,
  },
  symbolSelected: { color: theme.color.accentInk },
})
