import { type ReactNode } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import type { CurrencyBalance, GroupMember } from '@/lib/api'
import { theme } from '@/lib/theme'
import {
  currencySymbol,
  formatAmount,
  formatSigned,
  isAllSettled,
  visibleBalances,
} from '@/lib/balances-view'
import { GlossSurface } from './GlossSurface'
import { Avatar } from './Avatar'
import { Label } from './Label'

interface Props {
  balances: CurrencyBalance[]
  members: GroupMember[]
  /** Settle action button, rendered between the cards and the footnote. */
  action?: ReactNode
}

/**
 * Balances tab body — one soft-gloss card per currency with a non-zero net,
 * sorted by magnitude. Each card shows every member's signed net (green = owed,
 * red = owes) and a "to settle" sentence + amount pill derived from the minimal
 * transfer set. All balance math comes straight from `fetchBalances`; this view
 * only formats it (see `lib/balances-view`).
 *
 * The settle action itself is added at the tab level in Story 3.
 */
export function BalanceCard({ balances, action }: Props) {
  if (isAllSettled(balances)) {
    return (
      <GlossSurface style={styles.settled}>
        <Text style={styles.settledEmoji}>🎉</Text>
        <Text style={styles.settledTitle}>All settled up</Text>
        <Text style={styles.settledSub}>nobody owes anybody</Text>
      </GlossSurface>
    )
  }

  return (
    <View style={styles.container}>
      {visibleBalances(balances).map((balance) => (
        <CurrencyCard key={balance.currency} balance={balance} />
      ))}
      {action}
      <Text style={styles.footnote}>Balances update live as you add expenses.</Text>
    </View>
  )
}

function CurrencyCard({ balance }: { balance: CurrencyBalance }) {
  const symbol = currencySymbol(balance.currency)
  return (
    <GlossSurface style={styles.card}>
      {/* Header: currency code + faint symbol */}
      <View style={styles.header}>
        <Text style={styles.code}>{balance.currency}</Text>
        {symbol !== '' && <Text style={styles.symbol}>{symbol}</Text>}
      </View>

      {/* One row per member with their signed net */}
      {balance.netPositions.map((pos) => {
        const signed = formatSigned(pos.amount)
        return (
          <View key={pos.userId} style={styles.memberRow}>
            <Avatar name={pos.userName} size={28} />
            <Text style={styles.memberName}>{pos.userName ?? pos.userId}</Text>
            <Text style={[styles.memberAmount, signed.positive ? styles.green : styles.red]}>
              {signed.text}
            </Text>
          </View>
        )
      })}

      {/* To settle: one sentence + pill per transfer. Guarded — a non-zero net
          can round to no transfer (sub-cent), and an empty "TO SETTLE" reads as
          a bug. */}
      {balance.transfers.length > 0 && (
      <View style={styles.settleBlock}>
        <Label style={styles.settleLabel}>To settle</Label>
        {balance.transfers.map((t, i) => (
          <View key={i} style={styles.settleRow}>
            <Text style={styles.settleSentence}>
              <Text style={styles.bold}>{t.fromUserName ?? t.fromUserId}</Text>
              {' owes '}
              <Text style={styles.bold}>{t.toUserName ?? t.toUserId}</Text>
            </Text>
            <Text style={styles.pill}>
              {formatAmount(t.amount)} {t.currency}
            </Text>
          </View>
        ))}
      </View>
      )}
    </GlossSurface>
  )
}

const styles = StyleSheet.create({
  container: { gap: 13 },

  card: { overflow: 'hidden' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.md,
    paddingTop: theme.sp.sm,
    paddingBottom: 6,
  },
  code: {
    fontFamily: theme.font.monoBold,
    fontWeight: theme.weight.bold,
    fontSize: 13,
    letterSpacing: 1,
    color: theme.color.ink2,
  },
  symbol: {
    fontFamily: theme.font.mono,
    fontSize: 10.5,
    color: theme.color.ink3,
  },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp[11],
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.xs,
  },
  memberName: {
    flex: 1,
    fontFamily: theme.font.sans,
    fontSize: 15,
    fontWeight: theme.weight.medium,
    color: theme.color.ink,
  },
  memberAmount: {
    fontFamily: theme.font.monoBold,
    fontWeight: theme.weight.bold,
    fontSize: 15,
  },
  green: { color: theme.color.green },
  red: { color: theme.color.red },

  settleBlock: {
    borderTopWidth: 1,
    borderTopColor: theme.color.lineSoft,
    marginHorizontal: theme.sp.md,
    marginTop: 6,
    paddingTop: theme.sp.sm,
    paddingBottom: 14,
  },
  settleLabel: { marginBottom: theme.sp.xs },
  settleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.sp.xs,
    marginTop: theme.sp.xs,
  },
  settleSentence: {
    fontFamily: theme.font.sans,
    fontSize: 14.5,
    color: theme.color.ink,
  },
  bold: { fontWeight: theme.weight.bold },
  pill: {
    fontFamily: theme.font.monoBold,
    fontWeight: theme.weight.bold,
    fontSize: 13,
    color: theme.color.red,
    backgroundColor: theme.color.redBg,
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },

  settled: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 18,
  },
  settledEmoji: { fontSize: 30, marginBottom: 6 },
  settledTitle: {
    fontFamily: theme.font.sans,
    fontSize: 16,
    fontWeight: theme.weight.bold,
    color: theme.color.green,
  },
  settledSub: {
    fontFamily: theme.font.mono,
    fontSize: 12,
    color: theme.color.ink3,
    marginTop: 4,
  },

  footnote: {
    fontFamily: theme.font.mono,
    fontSize: 11,
    color: theme.color.ink3,
    textAlign: 'center',
    marginTop: 2,
  },
})
