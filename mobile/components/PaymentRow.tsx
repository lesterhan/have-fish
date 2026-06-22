import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { ExpenseGroup } from '@/lib/api'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'

interface Props {
  group: ExpenseGroup
  /** The current payer's display name. */
  payerName: string
  /** Head-truncated account leaf (e.g. `…:visa`); null renders the required state. */
  accountLabel: string | null
  /** When true, the account chip shows an empty/required visual (no default resolved). */
  accountMissing: boolean
  onPressPayer: () => void
  onPressAccount: () => void
}

/**
 * The payer + payment-account row beneath the numpad — a quiet, sentence-style
 * confirmation of *who paid from where*: `(💰 Les)  from  (…:visa)`. Presentational
 * only; the parent resolves the labels and supplies the handlers. All resolution
 * (seed, flip, override) lives in `lib/payment-row`.
 *
 * - Payer chip (left): leading wallet icon + name, content-sized, single line. A
 *   caret hints at the tap only when there's more than one member to choose from.
 * - `from` connective: static `ink3`, not a tap target.
 * - Account chip (right): head-truncated leaf, `flex: 1`, head-ellipsizes so the
 *   leaf survives. When `accountMissing`, it reads as a required affordance — this
 *   chip is how you clear the disabled-CTA state when no default exists.
 */
export function PaymentRow({
  group,
  payerName,
  accountLabel,
  accountMissing,
  onPressPayer,
  onPressAccount,
}: Props) {
  const payerInteractive = group.members.length > 1

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.payerChip}
        onPress={onPressPayer}
        onPressIn={haptics.selection}
        hitSlop={6}
      >
        <Ionicons name="wallet-outline" size={13} color={theme.color.ink2} />
        <Text style={styles.payerName} numberOfLines={1}>
          {payerName}
        </Text>
        {payerInteractive && <Text style={styles.caret}>▾</Text>}
      </Pressable>

      <Text style={styles.connective}>from</Text>

      <Pressable
        style={[styles.accountChip, accountMissing && styles.accountChipMissing]}
        onPress={onPressAccount}
        onPressIn={haptics.selection}
        hitSlop={6}
      >
        <Text
          style={[styles.accountLabel, accountMissing && styles.accountLabelMissing]}
          numberOfLines={1}
          ellipsizeMode="head"
        >
          {accountLabel ?? 'Select account'}
        </Text>
        <Text style={[styles.caret, accountMissing && styles.caretMissing]}>▾</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.xs,
  },
  payerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: theme.sp[7],
    paddingHorizontal: theme.sp[10],
    borderRadius: theme.radius.chip,
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.field,
    flexShrink: 0,
  },
  payerName: {
    fontFamily: theme.font.sans,
    fontSize: 13,
    fontWeight: theme.weight.semibold,
    color: theme.color.ink,
  },
  connective: {
    fontFamily: theme.font.sans,
    fontSize: 12,
    color: theme.color.ink3,
  },
  accountChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    paddingVertical: theme.sp[7],
    paddingHorizontal: theme.sp[10],
    borderRadius: theme.radius.chip,
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.field,
  },
  accountChipMissing: {
    borderColor: theme.color.accentLine,
    backgroundColor: theme.color.accentSoft,
  },
  accountLabel: {
    flexShrink: 1,
    fontFamily: theme.font.monoMedium,
    fontSize: 13,
    color: theme.color.ink,
  },
  accountLabelMissing: {
    fontFamily: theme.font.sans,
    color: theme.color.accentInk,
  },
  caret: {
    fontSize: 9,
    color: theme.color.ink2,
  },
  caretMissing: {
    color: theme.color.accentInk,
  },
})
