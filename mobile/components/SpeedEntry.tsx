import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ExpenseGroup } from '@/lib/api'
import { appendDigit, appendDot, backspace } from '@/lib/amount-input'
import { QUICK_CURRENCIES, lastCurrencyKey } from '@/lib/currency'
import { theme } from '@/lib/theme'
import { AmountHero } from './AmountHero'
import { Chip } from './Chip'
import { CurrencySheet } from './CurrencySheet'
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
 * - Story 1: amount hero + custom numpad input model.
 * - Story 2 (here): currency pill + quick chips + Currency sheet.
 * - Story 3: date chip + Date sheet.
 * - Story 4: paid-by segments + category rail.
 * - Story 5: submit, success flash, persistence.
 */
export function SpeedEntry({ group }: Props) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(group.defaultCurrency ?? 'CAD')
  const [currencyOpen, setCurrencyOpen] = useState(false)

  // Restore the last currency used in this group (persists across submits and
  // app launches). Falls back to the group default already in state.
  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(lastCurrencyKey(group.id)).then((saved) => {
      if (!cancelled && saved) setCurrency(saved)
    })
    return () => {
      cancelled = true
    }
  }, [group.id])

  function selectCurrency(code: string) {
    setCurrency(code)
    AsyncStorage.setItem(lastCurrencyKey(group.id), code).catch(() => {})
  }

  function handleKey(key: NumpadKey) {
    setAmount((current) => {
      if (key === '⌫') return backspace(current)
      if (key === '.') return appendDot(current)
      return appendDigit(current, key)
    })
  }

  return (
    <View style={styles.column}>
      <AmountHero
        amount={amount}
        currency={currency}
        dateLabel="Today"
        onPressCurrency={() => setCurrencyOpen(true)}
      />

      <View style={styles.quickRow}>
        {QUICK_CURRENCIES.map((code) => (
          <Chip
            key={code}
            label={code}
            active={currency === code}
            onPress={() => selectCurrency(code)}
          />
        ))}
        <Chip label="···" active={false} onPress={() => setCurrencyOpen(true)} />
      </View>

      <Numpad onKey={handleKey} onClear={() => setAmount('')} />

      <CurrencySheet
        visible={currencyOpen}
        selected={currency}
        onSelect={selectCurrency}
        onClose={() => setCurrencyOpen(false)}
      />
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
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.sp[7],
  },
})
