import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { ExpenseGroup } from '@/lib/api'
import { appendDigit, appendDot, backspace } from '@/lib/amount-input'
import { theme } from '@/lib/theme'
import { AmountHero } from './AmountHero'
import { Numpad, type NumpadKey } from './Numpad'

interface Props {
  group: ExpenseGroup
  /** Refresh the other tabs after a successful add (wired in Story 5). */
  onExpenseAdded: () => void
}

/**
 * The Add tab — single-job speed-entry screen. A mono amount hero driven by a
 * custom numpad, with inline currency / date / payer / category controls and a
 * one-tap Add. Tuned to fit a 412×892 frame without scrolling.
 *
 * Built incrementally across Companion epic 2:
 * - Story 1 (here): amount hero + custom numpad input model.
 * - Story 2: currency pill + quick chips + Currency sheet.
 * - Story 3: date chip + Date sheet.
 * - Story 4: paid-by segments + category rail.
 * - Story 5: submit, success flash, persistence.
 */
export function SpeedEntry({ group }: Props) {
  const [amount, setAmount] = useState('')
  const currency = group.defaultCurrency ?? 'CAD'

  function handleKey(key: NumpadKey) {
    setAmount((current) => {
      if (key === '⌫') return backspace(current)
      if (key === '.') return appendDot(current)
      return appendDigit(current, key)
    })
  }

  return (
    <View style={styles.column}>
      <AmountHero amount={amount} currency={currency} dateLabel="Today" />
      <Numpad onKey={handleKey} />
    </View>
  )
}

const styles = StyleSheet.create({
  column: {
    paddingTop: theme.sp[10],
    paddingHorizontal: theme.sp.md,
    paddingBottom: theme.sp.sm,
    gap: theme.sp[9],
  },
})
