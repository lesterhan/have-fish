import { Text, TouchableOpacity, StyleSheet } from 'react-native'
import { theme } from '@/lib/theme'

interface Props {
  label: string
  active?: boolean
  onPress: () => void
  disabled?: boolean
}

/**
 * Toggle chip — the shared pill used for currency / category / payer / member
 * selection across the group screens. Active = accent fill; inactive = inset
 * surface with a hairline border. Sharp-ish corners, on-brand with the Graphite
 * design system (no fully-rounded pills).
 */
export function Chip({ label, active = false, onPress, disabled = false }: Props) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.text, active && styles.textActive]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 7,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.windowInset,
  },
  chipActive: {
    backgroundColor: theme.color.accent,
    borderColor: theme.color.accent,
  },
  text: { fontSize: theme.text.sm, color: theme.color.text },
  textActive: { color: theme.color.textOnAccent, fontWeight: theme.weight.semibold },
})
