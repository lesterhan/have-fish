import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import {
  createBatchSettlement,
  fetchFxRateAsOf,
  type Account,
  type ExpenseGroup,
} from '@/lib/api'
import {
  buildBatchLines,
  convertedAmount,
  initLines,
  isConverted,
  linesReady,
  type OwedDebt,
  type SettleLine,
} from '@/lib/fish-pie-settle'
import { needsConversionAccount } from '@/lib/settle-actions'
import { currencyFlag } from '@/lib/currency'
import { type DateMode, dateLabel, resolveDate } from '@/lib/expense-date'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { BottomSheet } from './BottomSheet'
import { CurrencySheet } from './CurrencySheet'
import { DateSheet } from './DateSheet'
import { AccountPicker } from './AccountPicker'
import { GlossButton } from './GlossButton'
import { GlossSurface } from './GlossSurface'
import { Label } from './Label'

interface Props {
  visible: boolean
  group: ExpenseGroup
  /** Debts the current user owes, across currencies (owedDebts of the balances). */
  debts: OwedDebt[]
  /** The current user's own accounts, for the payer picker. */
  accounts: Account[]
  /** Default batch target = the user's preferred currency (sticky group ccy fallback). */
  defaultTargetCurrency: string
  /** Pre-selected payer account (the current user's group default), or '' for none. */
  defaultPayerAccountId: string
  /** Payer's conversion account; converting is blocked when null. */
  defaultConversionAccountId: string | null
  /** MRU currency list for the target picker ordering. */
  recents: string[]
  onClose: () => void
  /** Fired after a pending batch is created — the tab refreshes its data. */
  onSettled: () => void
}

const lineKey = (l: { toUserId: string; debtCurrency: string }) => l.toUserId + l.debtCurrency

/**
 * Batch settle-up sheet — records a **pending** cross-currency settlement.
 *
 * Lists every debt the current user owes; each line settles either natively (pay
 * the debt currency) or converted to a single target currency (pay the FX cash
 * amount, prefilled from the most recent rate, editable). One combined payer
 * transaction is created via `createBatchSettlement`; the receiver confirms it
 * separately (Story 4). A thin shell over the pure `fish-pie-settle` helpers.
 */
export function SettleSheet({
  visible,
  group,
  debts,
  accounts,
  defaultTargetCurrency,
  defaultPayerAccountId,
  defaultConversionAccountId,
  recents,
  onClose,
  onSettled,
}: Props) {
  const [target, setTarget] = useState(defaultTargetCurrency)
  const [lines, setLines] = useState<SettleLine[]>([])
  const [dateMode, setDateMode] = useState<DateMode>('today')
  const [pickDate, setPickDate] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [payerAccountId, setPayerAccountId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)

  // Guards stale FX responses from a superseded target/convert change.
  const rateToken = useRef(0)

  // Fetch the rate for every converted line lacking one and prefill its cash
  // amount (unless the user already typed an override).
  async function refreshRates(currentLines: SettleLine[], tgt: string) {
    const token = ++rateToken.current
    const results = await Promise.all(
      currentLines.map(async (l) => {
        if (!isConverted(l, tgt) || l.fxRate) return null
        const r = await fetchFxRateAsOf(l.debtCurrency, tgt)
        return { key: lineKey(l), rate: r?.rate ?? null, asOfDate: r?.asOfDate ?? null }
      }),
    )
    if (token !== rateToken.current) return // superseded by a newer change
    setLines((prev) =>
      prev.map((l) => {
        const match = results.find((x) => x && x.key === lineKey(l))
        if (!match) return l
        return {
          ...l,
          fxRate: match.rate,
          asOfDate: match.asOfDate,
          settledAmount: l.settledAmount || convertedAmount(l.debtAmount, match.rate),
        }
      }),
    )
  }

  // Seed + reset every time the sheet opens.
  useEffect(() => {
    if (!visible) return
    const seeded = initLines(debts, defaultTargetCurrency)
    setTarget(defaultTargetCurrency)
    setLines(seeded)
    setDateMode('today')
    setPickDate(null)
    setNote('')
    setPayerAccountId(defaultPayerAccountId)
    setError(null)
    void refreshRates(seeded, defaultTargetCurrency)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  function selectTarget(code: string) {
    // Same-currency lines can't convert; clear all prefilled rates and refetch.
    const next = lines.map((l) => ({
      ...l,
      convert: l.debtCurrency === code ? false : l.convert,
      fxRate: null,
      asOfDate: null,
      settledAmount: '',
    }))
    setTarget(code)
    setLines(next)
    void refreshRates(next, code)
  }

  function toggleConvert(i: number) {
    if (lines[i].debtCurrency === target) return // can't convert to the same currency
    const next = lines.map((l, idx) =>
      idx === i
        ? { ...l, convert: !l.convert, fxRate: null, asOfDate: null, settledAmount: '' }
        : l,
    )
    haptics.selection()
    setLines(next)
    void refreshRates(next, target)
  }

  function toggleInclude(i: number) {
    haptics.selection()
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, include: !l.include } : l)))
  }

  function setSettled(i: number, value: string) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, settledAmount: value } : l)))
  }

  const conversionMissing = needsConversionAccount(lines, target, defaultConversionAccountId)
  const ready = linesReady(lines, target) && !!payerAccountId && !conversionMissing

  async function handleSubmit() {
    if (!ready || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await createBatchSettlement(group.id, {
        payerAccountId,
        date: resolveDate(dateMode, pickDate),
        note: note.trim() || undefined,
        lines: buildBatchLines(lines, target),
      })
      haptics.success()
      onSettled()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to settle')
    } finally {
      setSubmitting(false)
    }
  }

  const resolvedDate = resolveDate(dateMode, pickDate)

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Settle up">
      {/* Target currency */}
      <View style={styles.targetRow}>
        <Label>Settle in</Label>
        <Pressable
          style={styles.targetPill}
          onPress={() => setCurrencyOpen(true)}
          onPressIn={haptics.selection}
        >
          <Text style={styles.targetFlag}>{currencyFlag(target)}</Text>
          <Text style={styles.targetCode}>{target}</Text>
          <Text style={styles.chevron}>▾</Text>
        </Pressable>
        <Text style={styles.targetHint}>converted debts are paid in this currency</Text>
      </View>

      {/* One line per owed debt */}
      <ScrollView style={styles.lines} contentContainerStyle={styles.linesContent}>
        {lines.map((l, i) => {
          const converted = isConverted(l, target)
          return (
            <GlossSurface
              key={lineKey(l)}
              base={l.include ? theme.color.surface : theme.color.surface2}
              radius={theme.radius.cardSm}
              style={styles.lineCard}
            >
              <View style={styles.lineHead}>
                <Pressable
                  hitSlop={8}
                  onPress={() => toggleInclude(i)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: l.include }}
                >
                  <Ionicons
                    name={l.include ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={l.include ? theme.color.accent : theme.color.ink3}
                  />
                </Pressable>
                <Text style={[styles.lineName, !l.include && styles.muted]} numberOfLines={1}>
                  You owe {l.toUserName ?? 'them'}
                </Text>
                <Text style={[styles.debtPill, !l.include && styles.muted]}>
                  {parseFloat(l.debtAmount).toFixed(2)} {l.debtCurrency}
                </Text>
              </View>

              {l.include && l.debtCurrency !== target && (
                <View style={styles.modeRow}>
                  <Pressable
                    style={[styles.modeBtn, !l.convert && styles.modeBtnOn]}
                    onPress={() => l.convert && toggleConvert(i)}
                  >
                    <Text style={[styles.modeText, !l.convert && styles.modeTextOn]}>
                      Pay {l.debtCurrency}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modeBtn, l.convert && styles.modeBtnOn]}
                    onPress={() => !l.convert && toggleConvert(i)}
                  >
                    <Text style={[styles.modeText, l.convert && styles.modeTextOn]}>
                      Pay {target}
                    </Text>
                  </Pressable>
                </View>
              )}

              {l.include && converted && (
                <View style={styles.convertBlock}>
                  <View style={styles.convertRow}>
                    <TextInput
                      style={styles.convertInput}
                      value={l.settledAmount}
                      onChangeText={(v) => setSettled(i, v)}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={theme.color.ink3}
                    />
                    <Text style={styles.convertCcy}>{target}</Text>
                  </View>
                  <Text style={styles.rateHint}>
                    {l.fxRate
                      ? `${l.debtCurrency} → ${target} rate ${parseFloat(l.fxRate).toFixed(4)} as of ${l.asOfDate}`
                      : 'no rate found — enter the amount you paid'}
                  </Text>
                </View>
              )}
            </GlossSurface>
          )
        })}
      </ScrollView>

      {conversionMissing && (
        <Text style={styles.guard}>
          Set a default conversion account on the web app to pay in another currency.
        </Text>
      )}

      {/* Payment */}
      <AccountPicker
        accounts={accounts}
        selectedId={payerAccountId}
        onSelect={setPayerAccountId}
        label="Paid from"
        placeholder="Account paid from…"
      />

      <View style={styles.metaRow}>
        <Pressable style={styles.metaField} onPress={() => setDateOpen(true)} onPressIn={haptics.selection}>
          <Label>Date</Label>
          <Text style={styles.metaValue}>{dateLabel(resolvedDate)}</Text>
        </Pressable>
        <View style={[styles.metaField, styles.noteField]}>
          <Label>Note</Label>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder="Optional"
            placeholderTextColor={theme.color.ink3}
            maxLength={120}
          />
        </View>
      </View>

      {error != null && <Text style={styles.error}>{error}</Text>}

      <GlossButton
        label={submitting ? 'Recording…' : 'Settle up'}
        disabled={!ready || submitting}
        onPress={handleSubmit}
        height={46}
        style={styles.submit}
      />

      <CurrencySheet
        visible={currencyOpen}
        selected={target}
        recents={recents}
        onSelect={selectTarget}
        onClose={() => setCurrencyOpen(false)}
      />
      <DateSheet
        visible={dateOpen}
        mode={dateMode}
        pickDate={pickDate}
        onSelect={(mode, pickISO) => {
          setDateMode(mode)
          if (mode === 'pick') setPickDate(pickISO ?? null)
        }}
        onClose={() => setDateOpen(false)}
      />
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.sp.xs,
    marginBottom: theme.sp.sm,
  },
  targetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.chip,
    borderWidth: 1.5,
    borderColor: theme.color.line,
    backgroundColor: theme.color.field,
  },
  targetFlag: { fontSize: 15 },
  targetCode: { fontFamily: theme.font.monoBold, fontSize: 14, color: theme.color.ink },
  chevron: { fontSize: 11, color: theme.color.ink2 },
  targetHint: { flex: 1, fontFamily: theme.font.sans, fontSize: 12, color: theme.color.ink3 },

  lines: { maxHeight: 260 },
  linesContent: { gap: theme.sp.xs, paddingVertical: 2 },
  lineCard: { padding: theme.sp.sm, gap: theme.sp.xs },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm },
  lineName: {
    flex: 1,
    fontFamily: theme.font.sans,
    fontSize: 14.5,
    fontWeight: theme.weight.semibold,
    color: theme.color.ink,
  },
  muted: { opacity: 0.45 },
  debtPill: {
    fontFamily: theme.font.monoBold,
    fontSize: 13,
    color: theme.color.ink2,
  },

  modeRow: { flexDirection: 'row', gap: 6, marginLeft: 30 },
  modeBtn: {
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 5,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.surface2,
  },
  modeBtnOn: { borderColor: theme.color.accentLine, backgroundColor: theme.color.accentSoft },
  modeText: { fontFamily: theme.font.monoMedium, fontSize: 12, color: theme.color.ink2 },
  modeTextOn: { color: theme.color.accentInk },

  convertBlock: { marginLeft: 30, gap: 3 },
  convertRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.xs },
  convertInput: {
    width: 120,
    fontFamily: theme.font.monoMedium,
    fontSize: 15,
    color: theme.color.ink,
    backgroundColor: theme.color.field,
    borderWidth: 1.5,
    borderColor: theme.color.line,
    borderRadius: theme.radius.field,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  convertCcy: { fontFamily: theme.font.monoBold, fontSize: 13, color: theme.color.ink2 },
  rateHint: { fontFamily: theme.font.mono, fontSize: 11, color: theme.color.ink3, fontStyle: 'italic' },

  guard: {
    fontFamily: theme.font.sans,
    fontSize: 12.5,
    color: theme.color.ink2,
    textAlign: 'center',
    marginTop: theme.sp.xs,
  },

  metaRow: { flexDirection: 'row', gap: theme.sp.sm, marginTop: theme.sp.sm },
  metaField: { gap: 4 },
  noteField: { flex: 1 },
  metaValue: {
    fontFamily: theme.font.mono,
    fontSize: 13,
    color: theme.color.ink,
    paddingVertical: 7,
  },
  noteInput: {
    fontFamily: theme.font.sans,
    fontSize: 14,
    color: theme.color.ink,
    backgroundColor: theme.color.field,
    borderWidth: 1.5,
    borderColor: theme.color.line,
    borderRadius: theme.radius.field,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },

  error: {
    fontFamily: theme.font.sans,
    fontSize: 12.5,
    color: theme.color.red,
    textAlign: 'center',
    marginTop: theme.sp.xs,
  },
  submit: { marginTop: theme.sp.md },
})
