import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  createTransaction,
  fetchAccounts,
  fetchUserSettings,
  type Account,
} from '@/lib/api'
import { accountLeaf } from '@/lib/account-search'
import { walletCurrency, type WalletView } from '@/lib/cash-accounts'
import {
  buildTopUpPostings,
  effectiveRate,
  formatRate,
  impliedReceived,
  isCrossCurrency,
  topUpBlocker,
  topUpBlockerMessage,
  type TopUpDraft,
} from '@/lib/cash-topup'
import { resolveDate, type DateMode } from '@/lib/expense-date'
import { submitOutcome } from '@/lib/expense-submit'
import { useShellMode } from '@/lib/shell-mode-context'
import { useWallets } from '@/lib/wallet-context'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { AccountSelect } from './AccountSelect'
import { BottomSheet } from './BottomSheet'
import { GlossButton } from './GlossButton'
import { GlossSurface } from './GlossSurface'
import { Label } from './Label'

interface Props {
  visible: boolean
  onClose: () => void
  wallet: WalletView
}

/**
 * Top up a wallet — the ATM stop and the exchange counter.
 *
 * Same-currency is two postings and asks only what left the account: what
 * arrives is what left, less any fee, so entering it separately would only be a
 * chance to contradict yourself.
 *
 * Cross-currency asks both sides, because only the counter knows what rate you
 * actually got. It bridges through the conversion account (the Currency
 * Transfers shape) and shows the all-in rate before you save — a bad rate is
 * obvious next to the board, and invisible once it is in the ledger.
 */
export function TopUpSheet({ visible, onClose, wallet }: Props) {
  const { accent } = useShellMode()
  const { reload } = useWallets()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [conversionAccountId, setConversionAccountId] = useState<string | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [feeOpen, setFeeOpen] = useState(false)
  const [feeAccountId, setFeeAccountId] = useState<string | null>(null)
  const [sourceAmount, setSourceAmount] = useState('')
  const [receivedAmount, setReceivedAmount] = useState('')
  const [feeAmount, setFeeAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setError(null)
    setSourceAmount('')
    setReceivedAmount('')
    setFeeAmount('')
    fetchAccounts()
      .then(setAccounts)
      .catch(() => {})
    // The bridge account is a user setting, not something this flow can invent.
    fetchUserSettings()
      .then((s) => setConversionAccountId(s.defaultConversionAccountId))
      .catch(() => setConversionAccountId(null))
  }, [visible])

  const source = accounts.find((a) => a.id === sourceId) ?? null
  const sourceCurrency = source ? (walletCurrency(source) ?? '') : ''
  const targetCurrency = wallet.currency ?? ''

  const draft: TopUpDraft = useMemo(
    () => ({
      sourceAccountId: sourceId,
      sourceCurrency,
      sourceAmount,
      walletAccountId: wallet.id,
      walletCurrency: targetCurrency,
      walletAmount: receivedAmount,
      conversionAccountId,
      feeAccountId,
      feeAmount,
    }),
    [
      sourceId, sourceCurrency, sourceAmount, wallet.id, targetCurrency,
      receivedAmount, conversionAccountId, feeAccountId, feeAmount,
    ],
  )

  const cross = isCrossCurrency(draft)
  const blocker = topUpBlocker(draft)
  const rate = cross ? formatRate(sourceCurrency, targetCurrency, effectiveRate(sourceAmount, receivedAmount)) : null

  async function save() {
    if (busy || blocker != null) return
    setBusy(true)
    setError(null)
    try {
      await createTransaction({
        date: resolveDate('today' as DateMode, null),
        description: cross ? `Exchange to ${targetCurrency}` : 'Cash withdrawal',
        postings: buildTopUpPostings(draft),
      })
      haptics.success()
      await reload()
      onClose()
    } catch (e) {
      if (submitOutcome(e) === 'queued') {
        haptics.success()
        onClose()
      } else {
        setError(e instanceof Error ? e.message : 'Failed to save')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Top up ${wallet.label}`}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View>
          <Label>From</Label>
          <AccountSelect
            accounts={accounts}
            selectedId={sourceId ?? ''}
            open={sourceOpen}
            onOpenChange={setSourceOpen}
            placeholder="Pick an account"
            onSelect={setSourceId}
            onCreate={(account) => setAccounts((current) => [...current, account])}
          />
        </View>

        <AmountField
          label={cross ? `Left the account (${sourceCurrency})` : 'Amount'}
          value={sourceAmount}
          onChange={setSourceAmount}
          currency={sourceCurrency}
        />

        {/* Only the counter knows the rate, so a cross-currency movement has to
            ask both sides; a same-currency one can work the arrival out. */}
        {cross && (
          <AmountField
            label={`Landed in the wallet (${targetCurrency})`}
            value={receivedAmount}
            onChange={setReceivedAmount}
            currency={targetCurrency}
          />
        )}

        <AmountField
          label={`Fee (optional, ${sourceCurrency || '—'})`}
          value={feeAmount}
          onChange={setFeeAmount}
          currency={sourceCurrency}
        />

        {feeAmount !== '' && (
          <View>
            <Label>Fee account</Label>
            <AccountSelect
              accounts={accounts}
              selectedId={feeAccountId ?? ''}
              open={feeOpen}
              onOpenChange={setFeeOpen}
              placeholder="Where to book the fee"
              onSelect={setFeeAccountId}
              onCreate={(account) => setAccounts((current) => [...current, account])}
            />
          </View>
        )}

        <GlossSurface base={theme.color.surface2} style={styles.summary}>
          {cross ? (
            <>
              <Text style={styles.summaryLabel}>Rate you got</Text>
              <Text style={[styles.summaryValue, { color: accent.ink }]}>
                {rate ?? 'Enter both amounts'}
              </Text>
              <Text style={styles.summaryNote}>
                All-in, fee included — the number to check against the board.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.summaryLabel}>Into the wallet</Text>
              <Text style={[styles.summaryValue, { color: accent.ink }]}>
                {sourceAmount === ''
                  ? '—'
                  : `${impliedReceived(sourceAmount, feeAmount)} ${targetCurrency}`}
              </Text>
            </>
          )}
        </GlossSurface>

        {error != null && <Text style={styles.error}>{error}</Text>}
        {error == null && blocker != null && sourceAmount !== '' && (
          <Text style={styles.hint}>{topUpBlockerMessage(blocker)}</Text>
        )}

        <GlossButton
          label={busy ? 'Saving…' : 'Record top-up'}
          disabled={blocker != null || busy}
          onPress={save}
        />
      </ScrollView>
    </BottomSheet>
  )
}

function AmountField({
  label,
  value,
  onChange,
  currency,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  currency: string
}) {
  return (
    <View>
      <Label>{label}</Label>
      <View style={styles.field}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder="0.00"
          placeholderTextColor={theme.color.ink3}
          keyboardType="decimal-pad"
          inputMode="decimal"
        />
        {currency !== '' && <Text style={styles.fieldCurrency}>{currency}</Text>}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: theme.sp.sm, paddingBottom: theme.sp.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.xs,
    borderRadius: theme.radius.field,
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.field,
    paddingHorizontal: theme.sp.sm,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: theme.font.monoMedium,
    fontSize: theme.text.base,
    color: theme.color.ink,
  },
  fieldCurrency: {
    fontFamily: theme.font.mono,
    fontSize: theme.text.xs,
    color: theme.color.ink3,
  },
  summary: { padding: theme.sp.sm, gap: 2 },
  summaryLabel: { fontSize: theme.text.xs, color: theme.color.ink3 },
  summaryValue: { fontFamily: theme.font.monoSemibold, fontSize: theme.text.lg },
  summaryNote: { fontSize: theme.text.xs, color: theme.color.ink2, marginTop: 2 },
  hint: { fontSize: theme.text.xs, color: theme.color.ink2, textAlign: 'center' },
  error: { fontSize: theme.text.sm, color: theme.color.red, textAlign: 'center' },
})
