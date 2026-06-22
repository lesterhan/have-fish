import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createExpense, fetchAccounts, type Account, type ExpenseGroup } from '@/lib/api'
import { getEmail } from '@/lib/auth'
import { appendDigit, appendDot, backspace } from '@/lib/amount-input'
import {
  RECENT_CURRENCIES_KEY,
  isSupportedCurrency,
  lastCurrencyKey,
  pushRecent,
} from '@/lib/currency'
import { type DateMode, dateLabel, resolveDate } from '@/lib/expense-date'
import {
  activeCategories,
  defaultPayerId,
  lastCategoryKey,
  resolveMyUserId,
} from '@/lib/group-entry'
import {
  accountChipLabel,
  nextPayerOnTap,
  resolveAccountOnPayerChange,
  seedAccountForPayer,
  shouldOpenPayerSheet,
} from '@/lib/payment-row'
import { buildExpenseBody, canSubmit, submitOutcome } from '@/lib/expense-submit'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { AccountSelect } from './AccountSelect'
import { AmountHero } from './AmountHero'
import { CategoryRail } from './CategoryRail'
import { CurrencySheet } from './CurrencySheet'
import { DateSheet } from './DateSheet'
import { GlossButton } from './GlossButton'
import { Label } from './Label'
import { Numpad, type NumpadKey } from './Numpad'
import { PaymentRow } from './PaymentRow'
import { PayerSheet } from './PayerSheet'

/** How long the green "✓ Added" / "✓ Queued" confirmation lingers (ms). */
const FLASH_MS = 1300

type Status = 'idle' | 'saving' | 'added' | 'queued' | 'error'

interface Props {
  group: ExpenseGroup
  /** Refresh the other tabs after a successful add (wired in Story 5). */
  onExpenseAdded: () => void
}

/**
 * The Add tab — single-job speed-entry screen. A mono amount hero driven by a
 * custom numpad, a description + category rail, then a compact payer/account
 * confirmation row beneath the numpad, and a one-tap Add. Reads top-to-bottom as
 * "Les paid 150.55 from Visa". Tuned to fit a 412×892 frame without scrolling.
 *
 * Built incrementally across Companion epic 2:
 * - Story 1: amount hero + custom numpad input model.
 * - Story 2: currency pill + two-step Currency sheet (recents + full).
 * - Story 3: date chip + Date sheet.
 * - Story 4: paid-by + category rail.
 * - Story 5: submit, success flash, persistence.
 *
 * Companion Payment Row epic: the paid-by segments were replaced by the in-app
 * {@link PaymentRow} (payer chip + payment-account picker), seeding from the
 * payer's per-group default but user-overridable — removing the web-only
 * default-account dependency.
 */
export function SpeedEntry({ group, onExpenseAdded }: Props) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [currency, setCurrency] = useState(group.defaultCurrency ?? 'CAD')
  const [recents, setRecents] = useState<string[]>([])
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const [dateMode, setDateMode] = useState<DateMode>('today')
  const [pickDate, setPickDate] = useState<string | null>(null)
  const [dateOpen, setDateOpen] = useState(false)
  const [paidByUserId, setPaidByUserId] = useState(group.members[0]?.userId ?? '')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [userTouchedAccount, setUserTouchedAccount] = useState(false)
  const [accountSheetOpen, setAccountSheetOpen] = useState(false)
  const [payerSheetOpen, setPayerSheetOpen] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const categories = useMemo(() => activeCategories(group), [group])
  const payer = group.members.find((m) => m.userId === paidByUserId) ?? null
  const selectedAccount = accounts.find((a) => a.id === paymentAccountId) ?? null
  const accountMissing = paymentAccountId === ''
  // Resolved id but the account isn't in the (possibly offline/empty) list yet —
  // keep the chip in its "set" state with a neutral placeholder rather than
  // flipping to the required visual.
  const accountLabel = selectedAccount
    ? accountChipLabel(selectedAccount)
    : accountMissing
      ? null
      : '…'

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])

  // Load the caller's accounts once (for the payment-account picker's label
  // resolution). Tolerate offline — an empty list still lets the sheet's inline
  // "create" path work, and the chip falls back gracefully.
  useEffect(() => {
    let cancelled = false
    fetchAccounts()
      .then((a) => !cancelled && setAccounts(a))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

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

  // Default the payer to the caller (matched by email), falling back to the
  // first member, and seed that payer's default payment account. Restore the
  // sticky category for this group (validated against the group's active
  // categories), else clear it. A new group is a fresh entry context: clear any
  // manual account override so the seed applies.
  useEffect(() => {
    let cancelled = false
    setUserTouchedAccount(false)
    getEmail()
      .then((email) => {
        if (cancelled) return
        const payerId = defaultPayerId(group, resolveMyUserId(group, email)) ?? ''
        setPaidByUserId(payerId)
        setPaymentAccountId(seedAccountForPayer(group, payerId))
      })
      .catch(() => {
        // SecureStore read failed — fall back to the first member and seed from it.
        if (cancelled) return
        const payerId = group.members[0]?.userId ?? ''
        setPaidByUserId(payerId)
        setPaymentAccountId(seedAccountForPayer(group, payerId))
      })
    AsyncStorage.getItem(lastCategoryKey(group.id))
      .then((saved) => {
        if (cancelled) return
        const valid = saved != null && group.categories.some((c) => c.id === saved && c.archivedAt == null)
        setCategoryId(valid ? saved : null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id])

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

  function selectDate(mode: DateMode, pickISO?: string) {
    setDateMode(mode)
    if (mode === 'pick') setPickDate(pickISO ?? null)
  }

  // Change the payer and re-seed the payment account from the new payer's default
  // — unless the user manually overrode the account this session (override wins).
  function selectPayer(nextPayerId: string) {
    setPaymentAccountId((current) =>
      resolveAccountOnPayerChange(group, paidByUserId, nextPayerId, userTouchedAccount, current),
    )
    setPaidByUserId(nextPayerId)
  }

  // Payer chip tap: flip instantly for a 2-member group; open the picker for 3+.
  function handlePressPayer() {
    if (shouldOpenPayerSheet(group)) {
      setPayerSheetOpen(true)
      return
    }
    selectPayer(nextPayerOnTap(group, paidByUserId))
  }

  // Manual account pick from the AccountSelect sheet — flags the override so a
  // later payer flip won't clobber it.
  function selectAccount(id: string) {
    setPaymentAccountId(id)
    setUserTouchedAccount(true)
  }

  function handleKey(key: NumpadKey) {
    setAmount((current) => {
      if (key === '⌫') return backspace(current)
      if (key === '.') return appendDot(current)
      return appendDigit(current, key)
    })
  }

  // Persist the sticky category per group (or clear it when uncategorized), so
  // a repeat entry pre-selects the same category across app launches — matching
  // the cross-launch currency stickiness.
  function persistCategory(id: string | null) {
    if (id) AsyncStorage.setItem(lastCategoryKey(group.id), id).catch(() => {})
    else AsyncStorage.removeItem(lastCategoryKey(group.id)).catch(() => {})
  }

  function flashThenReset(next: 'added' | 'queued') {
    setStatus(next)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setStatus('idle'), FLASH_MS)
  }

  async function handleSubmit() {
    if (status === 'saving' || !canSubmit(amount, paymentAccountId)) return
    setErrorMsg(null)
    setStatus('saving')
    const body = buildExpenseBody({
      description,
      amount,
      currency,
      date: resolveDate(dateMode, pickDate),
      paidByUserId,
      // Guarded by canSubmit: paymentAccountId is non-empty here.
      paymentAccountId,
      categoryId,
    })
    try {
      await createExpense(group.id, body)
      // Clear only the per-entry fields; currency / payer / category / date stay
      // sticky (you usually log several in a row).
      setAmount('')
      setDescription('')
      persistCategory(categoryId)
      haptics.success()
      flashThenReset('added')
      onExpenseAdded()
    } catch (e) {
      if (submitOutcome(e) === 'queued') {
        // Enqueued offline — treat as a soft success, but don't refresh the
        // other tabs (nothing has hit the server yet).
        setAmount('')
        setDescription('')
        persistCategory(categoryId)
        haptics.success()
        flashThenReset('queued')
      } else {
        setStatus('error')
        setErrorMsg(e instanceof Error ? e.message : 'Failed to add expense')
      }
    }
  }

  // Resolve relative modes against the current clock each render so the chip
  // (and the eventual submit) reflect "today" even past midnight. One `now`
  // feeds both calls so they can't straddle a midnight tick.
  const now = new Date()
  const resolvedDate = resolveDate(dateMode, pickDate, now)

  return (
    <View style={styles.column}>
      <AmountHero
        amount={amount}
        currency={currency}
        dateLabel={dateLabel(resolvedDate, now)}
        onPressCurrency={() => setCurrencyOpen(true)}
        onPressDate={() => setDateOpen(true)}
      />

      <View style={styles.block}>
        <Label>Description</Label>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder="Untitled"
          placeholderTextColor={theme.color.ink3}
          returnKeyType="done"
          maxLength={120}
        />
      </View>

      {categories.length > 0 && (
        <View style={styles.block}>
          <Label>Category</Label>
          <CategoryRail categories={categories} selectedId={categoryId} onSelect={setCategoryId} />
        </View>
      )}

      <Numpad onKey={handleKey} onClear={() => setAmount('')} />

      <View style={styles.block}>
        <Label>Paid by</Label>
        <PaymentRow
          group={group}
          payerName={payer?.userName ?? ''}
          accountLabel={accountLabel}
          accountMissing={accountMissing}
          onPressPayer={handlePressPayer}
          onPressAccount={() => setAccountSheetOpen(true)}
        />
      </View>

      {status === 'error' && errorMsg != null && <Text style={styles.error}>{errorMsg}</Text>}

      <GlossButton
        label={status === 'added' ? '✓ Added' : status === 'queued' ? '✓ Queued — will sync' : 'Add Expense'}
        success={status === 'added' || status === 'queued'}
        disabled={status === 'saving' || !canSubmit(amount, paymentAccountId)}
        onPress={handleSubmit}
      />

      <CurrencySheet
        visible={currencyOpen}
        selected={currency}
        recents={recents}
        onSelect={selectCurrency}
        onClose={() => setCurrencyOpen(false)}
      />

      <DateSheet
        visible={dateOpen}
        mode={dateMode}
        pickDate={pickDate}
        onSelect={selectDate}
        onClose={() => setDateOpen(false)}
      />

      <PayerSheet
        visible={payerSheetOpen}
        group={group}
        paidByUserId={paidByUserId}
        onSelect={selectPayer}
        onClose={() => setPayerSheetOpen(false)}
      />

      <AccountSelect
        accounts={accounts}
        selectedId={paymentAccountId}
        onSelect={selectAccount}
        onCreate={(account) => setAccounts((prev) => [...prev, account])}
        label="Payment account"
        open={accountSheetOpen}
        onOpenChange={setAccountSheetOpen}
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
  block: { gap: 6 },
  input: {
    fontFamily: theme.font.sans,
    fontSize: 14,
    color: theme.color.ink,
    backgroundColor: theme.color.field,
    borderWidth: 1.5,
    borderColor: theme.color.line,
    borderRadius: theme.radius.field,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  error: {
    fontFamily: theme.font.sans,
    fontSize: 12.5,
    color: theme.color.red,
    textAlign: 'center',
  },
})
