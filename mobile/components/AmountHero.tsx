import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { theme } from '@/lib/theme'
import * as haptics from '@/lib/haptics'
import { formatAmountDisplay, isPositiveAmount } from '@/lib/amount-input'
import { GlossSurface } from './GlossSurface'
import { Label } from './Label'

interface Props {
  /** Raw typed amount string (no thousands separators). */
  amount: string
  /** Active currency code, shown inline before the amount. */
  currency: string
  /** Human label for the chosen date ("Today" / "Yesterday" / ISO). */
  dateLabel: string
  /** Opens the Currency sheet (Story 2). */
  onPressCurrency?: () => void
  /** Opens the Date sheet (Story 3). */
  onPressDate?: () => void
}

/**
 * Amount hero card — the top block of the Add screen. A soft-gloss surface: the
 * AMOUNT label on the left and an elevated date chip on the right, then a single
 * ledger-style row below — the muted currency code on the left, the big amount
 * readout on the right. Tapping that row opens the Currency sheet; the amount is
 * driven by the custom numpad, so this card never raises the OS keyboard.
 */
export function AmountHero({ amount, currency, dateLabel, onPressCurrency, onPressDate }: Props) {
  const positive = isPositiveAmount(amount)
  return (
    <GlossSurface radius={theme.radius.card} style={styles.card}>
      <View style={styles.topRow}>
        <Label>Amount</Label>
        <Pressable
          style={styles.dateChip}
          onPress={onPressDate}
          onPressIn={onPressDate && haptics.selection}
          hitSlop={6}
        >
          <Ionicons name="calendar-outline" size={12} color={theme.color.ink} />
          <Text style={styles.dateLabel}>{dateLabel}</Text>
          <Text style={styles.dateCaret}>▾</Text>
        </Pressable>
      </View>

      <Pressable
        style={styles.amountRow}
        onPress={onPressCurrency}
        onPressIn={onPressCurrency && haptics.selection}
        hitSlop={6}
      >
        <Text style={styles.currency}>{currency} ▾</Text>
        <Text
          style={[styles.amount, positive ? styles.amountActive : styles.amountEmpty]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {formatAmountDisplay(amount)}
        </Text>
      </Pressable>
    </GlossSurface>
  )
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: theme.sp[11],
    paddingHorizontal: theme.sp.md,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.sp.sm,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: theme.sp[7],
    paddingHorizontal: theme.sp[10],
    borderRadius: theme.radius.chip,
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.surface2,
  },
  dateLabel: {
    fontFamily: theme.font.monoSemibold,
    fontSize: 11,
    color: theme.color.ink,
  },
  dateCaret: {
    fontSize: 9,
    color: theme.color.ink2,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: theme.sp.sm,
  },
  currency: {
    fontFamily: theme.font.monoSemibold,
    fontSize: 14,
    letterSpacing: 0.5,
    color: theme.color.ink2,
    flexShrink: 0,
  },
  amount: {
    flex: 1,
    fontFamily: theme.font.monoBold,
    fontSize: 40,
    letterSpacing: -1.5,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    minHeight: 44,
  },
  amountActive: { color: theme.color.ink },
  amountEmpty: { color: theme.color.ink3 },
})
