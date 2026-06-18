import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { theme } from '@/lib/theme'
import { formatAmountDisplay, isPositiveAmount } from '@/lib/amount-input'
import { GlossLayers } from './GlossLayers'
import { GlossSurface } from './GlossSurface'
import { Label } from './Label'

interface Props {
  /** Raw typed amount string (no thousands separators). */
  amount: string
  /** Active currency code, shown in the pill. */
  currency: string
  /** Human label for the chosen date ("Today" / "Yesterday" / ISO). */
  dateLabel: string
  /** Opens the Currency sheet (Story 2). */
  onPressCurrency?: () => void
  /** Opens the Date sheet (Story 3). */
  onPressDate?: () => void
}

/**
 * Amount hero card — the top block of the Add screen. A soft-gloss surface with
 * the AMOUNT label + date chip on the left, the accent currency pill on the
 * right, and the big right-aligned amount readout below. The amount is driven by
 * the custom numpad; this card never raises the OS keyboard.
 */
export function AmountHero({ amount, currency, dateLabel, onPressCurrency, onPressDate }: Props) {
  const positive = isPositiveAmount(amount)
  return (
    <GlossSurface radius={theme.radius.card} style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.leftCluster}>
          <Label>Amount</Label>
          <Pressable style={styles.dateChip} onPress={onPressDate} hitSlop={6}>
            <Ionicons name="calendar-outline" size={12} color={theme.color.ink2} />
            <Text style={styles.dateLabel}>{dateLabel}</Text>
            <Text style={styles.dateCaret}>▾</Text>
          </Pressable>
        </View>

        <Pressable style={styles.currencyPill} onPress={onPressCurrency} hitSlop={6}>
          <GlossLayers base={theme.color.accent} radius={theme.radius.md} accent />
          <Text style={styles.currencyText}>{currency} ▾</Text>
        </Pressable>
      </View>

      <Text
        style={[styles.amount, positive ? styles.amountActive : styles.amountEmpty]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {formatAmountDisplay(amount)}
      </Text>
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
    marginBottom: 4,
  },
  leftCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp[9],
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dateLabel: {
    fontFamily: theme.font.monoSemibold,
    fontSize: 11,
    color: theme.color.ink2,
  },
  dateCaret: {
    fontSize: 9,
    color: theme.color.ink2,
  },
  currencyPill: {
    paddingVertical: 5,
    paddingHorizontal: theme.sp[11],
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.accent,
    borderWidth: 1,
    borderColor: theme.color.accentGlossBorder,
    overflow: 'hidden',
    ...theme.gloss.shadowButton,
  },
  currencyText: {
    fontFamily: theme.font.monoBold,
    fontSize: 12,
    letterSpacing: 0.8,
    color: theme.color.textOnAccent,
    textShadowColor: theme.gloss.accentTextShadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  amount: {
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
