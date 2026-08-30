import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { createTransaction, fetchAccounts, type Account } from '@/lib/api'
import { appendDigit, appendDot, backspace } from '@/lib/amount-input'
import {
  blockerMessage,
  buildCashPostings,
  fromCents,
  remainder,
  remainderCents,
  seedAmountForNewRow,
  submitBlocker,
  syncSingleRow,
  toCents,
  type SplitRow,
} from '@/lib/cash-entry'
import { randomPlaceholder } from '@/lib/description-placeholder'
import { dateLabel, resolveDate, type DateMode } from '@/lib/expense-date'
import { submitOutcome } from '@/lib/expense-submit'
import { useWallets } from '@/lib/wallet-context'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { AccountSelect } from './AccountSelect'
import { AmountHero } from './AmountHero'
import { DateSheet } from './DateSheet'
import { GlossButton } from './GlossButton'
import { GlossSurface } from './GlossSurface'
import { Numpad, type NumpadKey } from './Numpad'
import { SplitRows } from './SplitRows'

/** How long the "✓ Added" / "✓ Queued" confirmation lingers (ms). */
const FLASH_MS = 1300

type Status = 'idle' | 'saving' | 'added' | 'queued' | 'error'

let rowSeq = 0
const nextRowId = () => `row-${++rowSeq}`

/**
 * Spend tab — logging cash that has left your pocket.
 *
 * The personal-ledger sibling of the Fish Pie Add screen, and deliberately not
 * the same screen: this one has no payer, no group, and no settlement. What it
 * has instead is the split editor, because a cash purchase routinely lands in
 * more than one category and the alternative is three transactions describing
 * one payment.
 *
 * The numpad drives whichever amount is being edited — the hero by default, or a
 * split row once you tap one. One keypad, one focus, so the screen never raises
 * the OS keyboard for a number.
 *
 * Currency is the wallet's, not a choice: money leaving a CNY wallet is CNY. A
 * cross-currency movement is the top-up flow's job (story 5).
 */
export function CashSpend() {
  const router = useRouter()
  const { activeWallet, reload } = useWallets()

  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const placeholder = useMemo(() => randomPlaceholder(), [])
  const [dateMode, setDateMode] = useState<DateMode>('today')
  const [pickDate, setPickDate] = useState<string | null>(null)
  const [dateOpen, setDateOpen] = useState(false)
  const [rows, setRows] = useState<SplitRow[]>([
    { id: nextRowId(), accountId: null, amount: '' },
  ])
  // null = the numpad drives the hero; otherwise it drives this row's amount.
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [pickingRowId, setPickingRowId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])

  // The account picker needs the full list; tolerate offline, since the sheet's
  // inline-create path still works from an empty one.
  useEffect(() => {
    let cancelled = false
    fetchAccounts()
      .then((a) => !cancelled && setAccounts(a))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // A lone row is the hero total — keep them in step so an unsplit purchase
  // never asks for the same number twice.
  useEffect(() => {
    setRows((current) => syncSingleRow(current, amount))
  }, [amount])

  const currency = activeWallet?.currency ?? ''
  const split = rows.length > 1
  const left = remainderCents(amount, rows)
  const blocker = submitBlocker({ walletId: activeWallet?.id ?? null, total: amount, rows })

  function handleKey(key: NumpadKey) {
    const apply = (current: string) => {
      if (key === '⌫') return backspace(current)
      if (key === '.') return appendDot(current)
      return appendDigit(current, key)
    }

    if (editingRowId == null) {
      setAmount(apply)
      return
    }
    setRows((current) =>
      current.map((row) => (row.id === editingRowId ? { ...row, amount: apply(row.amount) } : row)),
    )
  }

  function clearActiveAmount() {
    haptics.warning()
    if (editingRowId == null) {
      setAmount('')
      return
    }
    setRows((current) =>
      current.map((row) => (row.id === editingRowId ? { ...row, amount: '' } : row)),
    )
  }

  function addRow() {
    setRows((current) => {
      // Adding the second row turns the implicit single row into an explicit
      // one, so the existing amount has to be pinned before the new row takes
      // the rest — otherwise both would claim the whole total.
      const pinned =
        current.length === 1
          ? [{ ...current[0], amount: fromCents(toCents(amount) ?? 0) }]
          : current
      const seeded = seedAmountForNewRow(amount, pinned)
      const row = { id: nextRowId(), accountId: null, amount: seeded }
      setPickingRowId(row.id)
      return [...pinned, row]
    })
  }

  function removeRow(id: string) {
    setRows((current) => {
      const next = current.filter((row) => row.id !== id)
      if (editingRowId === id) setEditingRowId(null)
      // Never leave the editor empty: one blank row is the resting state.
      return next.length > 0 ? next : [{ id: nextRowId(), accountId: null, amount: '' }]
    })
  }

  function flashThenReset(next: 'added' | 'queued') {
    setStatus(next)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setStatus('idle'), FLASH_MS)
  }

  function resetEntry() {
    setAmount('')
    setDescription('')
    setRows([{ id: nextRowId(), accountId: null, amount: '' }])
    setEditingRowId(null)
  }

  async function submit() {
    if (status === 'saving' || blocker != null || !activeWallet) return
    setErrorMsg(null)
    setStatus('saving')

    try {
      const postings = buildCashPostings({
        walletAccountId: activeWallet.id,
        currency,
        total: amount,
        rows,
      })
      await createTransaction({
        date: resolveDate(dateMode, pickDate),
        description: description.trim() || 'Cash',
        postings,
      })
      resetEntry()
      haptics.success()
      flashThenReset('added')
      reload()
    } catch (e) {
      if (submitOutcome(e) === 'queued') {
        // Enqueued offline — a soft success. Don't reload balances; nothing has
        // reached the server, and a refresh would show a stale figure as if it
        // were the new one.
        resetEntry()
        haptics.success()
        flashThenReset('queued')
      } else {
        setStatus('error')
        setErrorMsg(e instanceof Error ? e.message : 'Failed to save')
      }
    }
  }

  const now = new Date()
  const resolvedDate = resolveDate(dateMode, pickDate, now)

  // No wallet means nothing can be spent from — send the user to the tab that
  // can fix that rather than showing a form that can never submit.
  if (!activeWallet) {
    return (
      <View style={styles.center}>
        <GlossSurface style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No wallet yet</Text>
          <Text style={styles.emptyBody}>
            Cash spending comes out of a wallet. Make one and this screen is ready to use.
          </Text>
          <GlossButton
            label="Go to Wallets"
            onPress={() => router.replace('/(app)/cash-wallets')}
            style={styles.emptyAction}
          />
        </GlossSurface>
      </View>
    )
  }

  return (
    <View style={styles.column}>
      <AmountHero
        amount={amount}
        currency={currency}
        dateLabel={dateLabel(resolvedDate, now)}
        onPressDate={() => setDateOpen(true)}
      />

      <TextInput
        style={styles.description}
        value={description}
        onChangeText={setDescription}
        placeholder={placeholder}
        placeholderTextColor={theme.color.ink3}
        returnKeyType="done"
      />

      <SplitRows
        rows={rows}
        accounts={accounts}
        editingId={editingRowId}
        remainderText={split && left !== 0 ? `${remainder(amount, rows)} left` : null}
        onPickAccount={setPickingRowId}
        onEditAmount={(id) => setEditingRowId((current) => (current === id ? null : id))}
        onRemove={removeRow}
        onAdd={addRow}
      />

      <View style={styles.spacer} />

      {/* Says which amount the keypad is driving — with a split open, the same
          keys mean different things depending on what was last tapped. */}
      {split && (
        <Text style={styles.target}>
          {editingRowId == null ? 'Editing the total' : 'Editing this split'}
        </Text>
      )}

      <Numpad onKey={handleKey} onClear={clearActiveAmount} />

      {errorMsg != null && <Text style={styles.error}>{errorMsg}</Text>}
      {errorMsg == null && blocker != null && amount !== '' && (
        <Text style={styles.hint}>{blockerMessage(blocker, remainder(amount, rows))}</Text>
      )}

      <GlossButton
        label={
          status === 'added'
            ? '✓ Added'
            : status === 'queued'
              ? '✓ Saved offline'
              : status === 'saving'
                ? 'Saving…'
                : 'Add'
        }
        success={status === 'added' || status === 'queued'}
        disabled={blocker != null || status === 'saving'}
        onPress={submit}
        style={styles.submit}
      />

      <DateSheet
        visible={dateOpen}
        mode={dateMode}
        pickDate={pickDate}
        onSelect={(mode, date) => {
          setDateMode(mode)
          setPickDate(date ?? null)
        }}
        onClose={() => setDateOpen(false)}
      />

      <AccountSelect
        accounts={accounts}
        selectedId={rows.find((r) => r.id === pickingRowId)?.accountId ?? ''}
        open={pickingRowId != null}
        onOpenChange={(open) => !open && setPickingRowId(null)}
        label="Category"
        placeholder="Pick a category"
        onSelect={(id) => {
          const rowId = pickingRowId
          if (!rowId) return
          setRows((current) =>
            current.map((row) => (row.id === rowId ? { ...row, accountId: id } : row)),
          )
        }}
        onCreate={(account) => setAccounts((current) => [...current, account])}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  column: { flex: 1, padding: theme.sp.md, gap: theme.sp[9] },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.sp.md,
  },
  description: {
    borderRadius: theme.radius.field,
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.field,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 10,
    fontSize: theme.text.sm,
    color: theme.color.ink,
  },
  spacer: { flex: 1, minHeight: 0 },
  target: {
    fontSize: theme.text.xs,
    color: theme.color.ink3,
    textAlign: 'center',
  },
  hint: {
    fontSize: theme.text.xs,
    color: theme.color.ink2,
    textAlign: 'center',
  },
  error: {
    fontSize: theme.text.xs,
    color: theme.color.red,
    textAlign: 'center',
  },
  submit: { marginTop: 2 },
  emptyCard: { padding: theme.sp.lg, gap: theme.sp.xs, alignItems: 'center' },
  emptyTitle: {
    fontFamily: theme.font.serif,
    fontSize: theme.text.xl,
    color: theme.color.ink,
  },
  emptyBody: {
    fontSize: theme.text.sm,
    color: theme.color.ink2,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyAction: { alignSelf: 'stretch', marginTop: theme.sp.sm },
})
