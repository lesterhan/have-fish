import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  fetchAccounts,
  fetchUserSettings,
  type Account,
  type CurrencyBalance,
  type ExpenseGroup,
  type GroupSettlement,
  type UserSettings,
} from '@/lib/api'
import { getEmail } from '@/lib/auth'
import { owedDebts } from '@/lib/fish-pie-settle'
import { incomingBatches, receiptLines, settleAction, type IncomingBatch } from '@/lib/settle-actions'
import { resolveMyUserId } from '@/lib/group-entry'
import { RECENT_CURRENCIES_KEY, isSupportedCurrency, lastCurrencyKey } from '@/lib/currency'
import { theme } from '@/lib/theme'
import { BalanceCard } from './BalanceCard'
import { GlossButton } from './GlossButton'
import { GlossSurface } from './GlossSurface'
import { Label } from './Label'
import { SettleSheet } from './SettleSheet'
import { ConfirmSheet } from './ConfirmSheet'

interface Props {
  group: ExpenseGroup
  balances: CurrencyBalance[]
  settlements: GroupSettlement[]
  /** Shared cross-tab refresh, fired after a pending batch is recorded. */
  reloadData: () => Promise<void>
}

/**
 * Balances tab body — renders the per-currency cards (Story 1), the single settle
 * action + batch settle-up sheet (Story 3), and the receiver's confirm banners +
 * sheet (Story 4). Resolves the current user, their accounts and settings, then
 * derives the button state, incoming-batch banners and the sheet inputs from the
 * pure helpers.
 */
export function BalancesPanel({ group, balances, settlements, reloadData }: Props) {
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [recents, setRecents] = useState<string[]>([])
  const [stickyCurrency, setStickyCurrency] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [confirmBatch, setConfirmBatch] = useState<IncomingBatch | null>(null)

  // Identify the caller (by email) to know what they owe / are owed.
  useEffect(() => {
    let cancelled = false
    getEmail()
      .then((email) => {
        if (!cancelled) setMyUserId(resolveMyUserId(group, email))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [group])

  // The caller's accounts + settings power the payer picker and the target /
  // conversion-account defaults. Fetched once; cheap to refetch on group change.
  useEffect(() => {
    let cancelled = false
    fetchAccounts()
      .then((a) => !cancelled && setAccounts(a))
      .catch(() => {})
    fetchUserSettings()
      .then((s) => !cancelled && setSettings(s))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Currency MRU (global) + this group's last-used currency, for the target picker.
  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(RECENT_CURRENCIES_KEY)
      .then((raw) => {
        if (cancelled || !raw) return
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            setRecents(parsed.filter((c): c is string => typeof c === 'string' && isSupportedCurrency(c)))
          }
        } catch {
          // Corrupt value — ignore.
        }
      })
      .catch(() => {})
    AsyncStorage.getItem(lastCurrencyKey(group.id))
      .then((saved) => !cancelled && setStickyCurrency(saved))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [group.id])

  const action = useMemo(
    () => (myUserId ? settleAction(balances, settlements, myUserId) : { kind: 'none' as const }),
    [balances, settlements, myUserId],
  )
  const debts = useMemo(
    () => (myUserId ? owedDebts(balances, myUserId) : []),
    [balances, myUserId],
  )
  // Pending batches awaiting this user's confirmation (they're the receiver).
  const incoming = useMemo(
    () => (myUserId ? incomingBatches(settlements, myUserId) : []),
    [settlements, myUserId],
  )

  const myMember = myUserId ? group.members.find((m) => m.userId === myUserId) : undefined
  const defaultTargetCurrency =
    settings?.preferredCurrency || stickyCurrency || group.defaultCurrency || 'CAD'
  // The user's own group default account — pre-selects both the payer (settle)
  // and receiver (confirm) account.
  const defaultMyAccountId = myMember?.defaultPaymentAccountId ?? ''

  const button =
    action.kind === 'settle' ? (
      <GlossButton label="Settle up" height={46} onPress={() => setSheetOpen(true)} />
    ) : action.kind === 'pending' ? (
      <GlossButton label={`Recorded — awaiting ${action.receiverName}`} height={46} disabled onPress={() => {}} />
    ) : action.kind === 'waiting' ? (
      <GlossButton label={`Waiting for ${action.payerName} to pay`} height={46} disabled onPress={() => {}} />
    ) : null

  return (
    <>
      {/* Action-required: batches this user needs to confirm receipt of. */}
      {incoming.map((b) => (
        <GlossSurface key={b.key} style={styles.banner}>
          <Label>Confirm receipt</Label>
          <Text style={styles.bannerTitle}>{b.fromUserName} paid you</Text>
          <View style={styles.bannerAmounts}>
            {receiptLines(b.rows).map((r) => (
              <Text key={r.currency} style={styles.bannerPill}>
                {r.amount} {r.currency}
              </Text>
            ))}
          </View>
          <GlossButton label="Confirm receipt" height={42} onPress={() => setConfirmBatch(b)} />
        </GlossSurface>
      ))}

      <BalanceCard balances={balances} members={group.members} action={button} />

      <SettleSheet
        visible={sheetOpen}
        group={group}
        debts={debts}
        accounts={accounts}
        defaultTargetCurrency={defaultTargetCurrency}
        defaultPayerAccountId={defaultMyAccountId}
        defaultConversionAccountId={settings?.defaultConversionAccountId ?? null}
        recents={recents}
        onClose={() => setSheetOpen(false)}
        onSettled={reloadData}
      />

      <ConfirmSheet
        visible={confirmBatch != null}
        group={group}
        batch={confirmBatch}
        accounts={accounts}
        defaultReceiverAccountId={defaultMyAccountId}
        onClose={() => setConfirmBatch(null)}
        onConfirmed={reloadData}
      />
    </>
  )
}

const styles = StyleSheet.create({
  banner: { padding: theme.sp.md, gap: theme.sp.xs, marginBottom: 13 },
  bannerTitle: {
    fontFamily: theme.font.sans,
    fontSize: 15,
    fontWeight: theme.weight.semibold,
    color: theme.color.ink,
  },
  bannerAmounts: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.xs, marginBottom: 4 },
  bannerPill: {
    fontFamily: theme.font.monoBold,
    fontSize: 14,
    color: theme.color.green,
    backgroundColor: theme.color.greenBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
})
