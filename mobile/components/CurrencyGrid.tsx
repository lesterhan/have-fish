import { Pressable, StyleSheet, Text, View } from 'react-native'
import { currencyFlag } from '@/lib/currency'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { GlossSurface } from './GlossSurface'

/** Tint for the selected tile — each shell mode passes its own accent. */
export interface GridTint {
  soft: string
  ink: string
}

interface Props {
  /** Codes to show, already in display order. */
  codes: string[]
  /** Highlighted code, if any. */
  selected?: string | null
  /**
   * Codes that can't be picked. Shown dimmed and inert rather than omitted, so
   * a user hunting for a currency finds it and sees why it's unavailable.
   */
  disabledCodes?: ReadonlySet<string>
  tint?: GridTint
  onSelect: (code: string) => void
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
 * The flag + code tile grid, shared by the Add screen's currency picker and the
 * create-a-wallet flow. Stateless: callers own which codes to show (recents vs
 * the full catalogue) and render their own "More currencies" affordance, which
 * keeps the expand/reset behaviour with the sheet that has the visibility.
 */
export function CurrencyGrid({
  codes,
  selected,
  disabledCodes,
  tint = { soft: theme.color.accentSoft, ink: theme.color.accentInk },
  onSelect,
}: Props) {
  return (
    <>
      {intoRows(codes, COLUMNS).map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((code, j) => {
            if (code == null) return <View key={`spacer-${j}`} style={styles.tileSlot} />
            const isSelected = code === selected
            const isDisabled = disabledCodes?.has(code) ?? false
            return (
              <Pressable
                key={code}
                style={styles.tileSlot}
                disabled={isDisabled}
                onPress={() => onSelect(code)}
                onPressIn={isDisabled ? undefined : haptics.selection}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected, disabled: isDisabled }}
              >
                <GlossSurface
                  base={isSelected ? tint.soft : theme.color.surface2}
                  radius={theme.radius.field}
                  style={[styles.tile, isDisabled && styles.tileDisabled]}
                >
                  <Text style={[styles.flag, isDisabled && styles.dim]}>{currencyFlag(code)}</Text>
                  <Text
                    style={[
                      styles.code,
                      isSelected && { color: tint.ink },
                      isDisabled && styles.codeDisabled,
                    ]}
                  >
                    {code}
                  </Text>
                </GlossSurface>
              </Pressable>
            )
          })}
        </View>
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: theme.sp[9] },
  tileSlot: { flex: 1 },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: theme.sp.sm,
  },
  tileDisabled: { opacity: 0.45 },
  dim: { opacity: 0.6 },
  flag: { fontSize: 16 },
  code: {
    fontFamily: theme.font.monoBold,
    fontSize: 15,
    color: theme.color.ink,
  },
  codeDisabled: { color: theme.color.ink3 },
})
