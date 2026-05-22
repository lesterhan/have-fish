import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import type { CurrencyBalance, GroupMember } from '@/lib/api'

interface Props {
  balances: CurrencyBalance[]
  members: GroupMember[]
  onSettleUp: (transfer: CurrencyBalance['transfers'][number]) => void
}

/**
 * Balances tab — shows per-currency net positions and the minimal transfer set.
 *
 * Positive amount = creditor (is owed money).
 * Negative amount = debtor (owes money).
 *
 * TODO:
 * - Highlight the current user's row
 * - Grey out "Settle up" buttons for transfers the current user isn't a party to
 */
export function BalanceCard({ balances, members: _members, onSettleUp }: Props) {
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

          {/* Transfers (simplified) */}
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
                  <TouchableOpacity style={styles.settleButton} onPress={() => onSettleUp(t)}>
                    <Text style={styles.settleButtonText}>Settle up</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  settled: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  settledEmoji: { fontSize: 40, marginBottom: 8 },
  settledText: { fontSize: 16, color: '#27ae60', fontWeight: '600' },
  currencyBlock: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  currencyLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  positions: { gap: 6, marginBottom: 12 },
  positionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  memberName: { fontSize: 14, color: '#444' },
  positionAmount: { fontSize: 14, fontWeight: '600', color: '#888' },
  positive: { color: '#27ae60' },
  negative: { color: '#e74c3c' },
  transfers: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 10,
    gap: 8,
  },
  transfersLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  transferRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  transferText: { flex: 1, fontSize: 13, color: '#444', marginRight: 12 },
  bold: { fontWeight: '600' },
  transferAmount: { color: '#e74c3c', fontWeight: '700' },
  settleButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  settleButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
})
