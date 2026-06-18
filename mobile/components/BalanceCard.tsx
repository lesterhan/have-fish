import { View, Text, StyleSheet } from 'react-native'
import type { CurrencyBalance, GroupMember } from '@/lib/api'
import { theme, cardStyle } from '@/lib/theme'

interface Props {
  balances: CurrencyBalance[]
  members: GroupMember[]
}

/**
 * Balances tab — shows per-currency net positions and the minimal transfer set.
 *
 * Positive amount = creditor (is owed money).
 * Negative amount = debtor (owes money).
 *
 * View-only in the MVP: recording a settlement is deferred to mobile-revival
 * story 6 (settlement confirmation). The transfers are shown without a settle
 * action; the user settles on the web app for now.
 *
 * TODO:
 * - Highlight the current user's row
 */
export function BalanceCard({ balances, members: _members }: Props) {
  if (balances.length === 0 || balances.every((b) => b.transfers.length === 0)) {
    return (
      <View style={styles.settled}>
        <Text style={styles.settledEmoji}>✓</Text>
        <Text style={styles.settledText}>All settled up</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {balances.map((balance) => (
        <View key={balance.currency} style={styles.currencyBlock}>
          <Text style={styles.currencyLabel}>{balance.currency}</Text>

          {/* Net positions */}
          <View style={styles.positions}>
            {balance.netPositions.map((pos) => {
              const amount = parseFloat(pos.amount)
              const isCreditor = amount > 0
              const isDebtor = amount < 0
              return (
                <View key={pos.userId} style={styles.positionRow}>
                  <Text style={styles.memberName}>{pos.userName ?? pos.userId}</Text>
                  <Text
                    style={[
                      styles.positionAmount,
                      isCreditor && styles.positive,
                      isDebtor && styles.negative,
                    ]}
                  >
                    {isCreditor ? '+' : ''}
                    {pos.amount}
                  </Text>
                </View>
              )
            })}
          </View>

          {/* Transfers (suggested minimal settlement set) — view-only */}
          {balance.transfers.length > 0 && (
            <View style={styles.transfers}>
              <Text style={styles.transfersLabel}>To settle:</Text>
              {balance.transfers.map((t, i) => (
                <View key={i} style={styles.transferRow}>
                  <Text style={styles.transferText}>
                    <Text style={styles.bold}>{t.fromUserName ?? t.fromUserId}</Text>
                    {' owes '}
                    <Text style={styles.bold}>{t.toUserName ?? t.toUserId}</Text>
                    {'  '}
                    <Text style={styles.transferAmount}>
                      {t.amount} {t.currency}
                    </Text>
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}

      <Text style={styles.settleNote}>Record settlements on the web app for now.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: theme.sp.sm },
  settled: {
    alignItems: 'center',
    paddingVertical: theme.sp['2xl'],
  },
  settledEmoji: { fontSize: 40, marginBottom: theme.sp.xs },
  settledText: {
    fontSize: theme.text.base,
    color: theme.color.success,
    fontWeight: theme.weight.semibold,
  },
  currencyBlock: {
    ...cardStyle,
    padding: theme.sp.md,
  },
  currencyLabel: {
    fontSize: theme.text.xs,
    fontWeight: theme.weight.semibold,
    color: theme.color.textMuted,
    textTransform: 'uppercase',
    marginBottom: theme.sp.sm,
  },
  positions: { gap: 6, marginBottom: theme.sp.sm },
  positionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  memberName: { fontSize: theme.text.sm, color: theme.color.text },
  positionAmount: {
    fontSize: theme.text.sm,
    fontWeight: theme.weight.semibold,
    color: theme.color.textMuted,
  },
  positive: { color: theme.color.amountPositive },
  negative: { color: theme.color.amountNegative },
  transfers: {
    borderTopWidth: 1,
    borderTopColor: theme.color.ruleSoft,
    paddingTop: theme.sp.xs,
    gap: theme.sp.xs,
  },
  transfersLabel: {
    fontSize: theme.text.xs,
    fontWeight: theme.weight.semibold,
    color: theme.color.textMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  transferRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  transferText: {
    flex: 1,
    fontSize: theme.text.sm,
    color: theme.color.text,
    marginRight: theme.sp.sm,
  },
  bold: { fontWeight: theme.weight.semibold },
  transferAmount: { color: theme.color.amountNegative, fontWeight: theme.weight.semibold },
  settleNote: {
    fontSize: theme.text.xs,
    color: theme.color.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 4,
  },
})
