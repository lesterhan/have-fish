import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ExpenseGroup } from '@/lib/api'
import { appendDigit, appendDot, backspace } from '@/lib/amount-input'
import {
  RECENT_CURRENCIES_KEY,
  isSupportedCurrency,
  lastCurrencyKey,
  pushRecent,
} from '@/lib/currency'
import { theme } from '@/lib/theme'
import { AmountHero } from './AmountHero'
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
 * - Story 2 (here): currency pill + two-step Currency sheet (recents + full).
 * - Story 3: date chip + Date sheet.
 * - Story 4: paid-by segments + category rail.
 * - Story 5: submit, success flash, persistence.
 */
export function SpeedEntry({ group }: Props) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(group.defaultCurrency ?? 'CAD')
  const [recents, setRecents] = useState<string[]>([])
  const [currencyOpen, setCurrencyOpen] = useState(false)

  // Restore the group's sticky currency (per group) and the global recent list
  // (shared across groups). Both persist across submits and app launches.
  // Switching groups re-resolves the currency: the new group's saved value, or
  // its default — never leaving the previous group's currency stuck in state.
  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(lastCurrencyKey(group.id)).then((saved) => {
      if (cancelled) return
      setCurrency(saved ?? group.defaultCurrency ?? 'CAD')
    })
    return () => {
      cancelled = true
    }
  }, [group.id, group.defaultCurrency])

  useEffect(() => {
    AsyncStorage.getItem(RECENT_CURRENCIES_KEY).then((raw) => {
      if (!raw) return
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setRecents(parsed.filter((c): c is string => typeof c === 'string' && isSupportedCurrency(c)))
        }
      } catch {
        // Corrupt value — ignore and start fresh.
      }
    })
  }, [])

  function selectCurrency(code: string) {
    setCurrency(code)
    AsyncStorage.setItem(lastCurrencyKey(group.id), code).catch(() => {})
    setRecents((current) => {
      const next = pushRecent(current, code)
      AsyncStorage.setItem(RECENT_CURRENCIES_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
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

      <Numpad onKey={handleKey} onClear={() => setAmount('')} />

      <CurrencySheet
        visible={currencyOpen}
        selected={currency}
        recents={recents}
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
})
