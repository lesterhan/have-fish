import {
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  type ViewStyle,
} from 'react-native'
import { theme } from '@/lib/theme'

type Variant = 'primary' | 'neutral' | 'danger'
type Size = 'md' | 'sm'

interface Props {
  title: string
  onPress: () => void
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
  /** Extra layout style (e.g. flex, alignSelf, margins). */
  style?: ViewStyle
}

/**
 * Shared button — the one button primitive for the app.
 *
 * - **primary** — accent fill, light text. Submit / save / send / accept.
 * - **neutral** — inset surface, hairline border, muted text. Cancel / decline.
 * - **danger** — surface with a danger-tinted border + danger text. Destructive
 *   actions (delete / sign out).
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
}: Props) {
  const isDisabled = disabled || loading
  return (
    <TouchableOpacity
      style={[
        styles.base,
        size === 'sm' ? styles.sizeSm : styles.sizeMd,
        styles[variant],
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? theme.color.textOnAccent : theme.color.accent}
        />
      ) : (
        <Text style={[styles.text, size === 'sm' && styles.textSm, textStyle[variant]]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  base: {
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeMd: { paddingVertical: theme.sp.sm, paddingHorizontal: theme.sp.md },
  sizeSm: { paddingVertical: theme.sp.xs, paddingHorizontal: theme.sp.sm },
  primary: { backgroundColor: theme.color.accent },
  neutral: {
    backgroundColor: theme.color.windowInset,
    borderWidth: 1,
    borderColor: theme.color.rule,
  },
  danger: {
    backgroundColor: theme.color.window,
    borderWidth: 1,
    borderColor: theme.color.danger,
  },
  disabled: { opacity: 0.5 },
  text: { fontSize: theme.text.base, fontWeight: theme.weight.semibold },
  textSm: { fontSize: theme.text.sm },
})

const textStyle = StyleSheet.create({
  primary: { color: theme.color.textOnAccent },
  neutral: { color: theme.color.textMuted },
  danger: { color: theme.color.danger },
})
