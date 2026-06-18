import { Pressable, StyleSheet, Text } from 'react-native'
import { theme } from '@/lib/theme'
import { GlossSurface } from './GlossSurface'

interface Props {
  label: string
  active?: boolean
  onPress: () => void
  disabled?: boolean
  /** Mono label (currency codes). Off for word chips like categories. */
  mono?: boolean
}

/**
 * Toggle chip — the shared pill for currency / category / quick-pick selection.
 *
 * Companion design: inactive = `field` bg + 1.5px `line` border, `ink2`; active =
 * neutral soft-gloss on `accentSoft` + 1.5px `accentLine` border, `accentInk`,
 * weight 700.
 */
export function Chip({ label, active = false, onPress, disabled = false, mono = true }: Props) {
  const fontFamily = mono
    ? active
      ? theme.font.monoBold
      : theme.font.mono
    : theme.font.sans
  const text = (
    <Text
      style={[
        styles.text,
        { fontFamily },
        active ? styles.textActive : styles.textInactive,
      ]}
      numberOfLines={1}
    >
      {label}
    </Text>
  )

  if (active) {
    return (
      <Pressable onPress={onPress} disabled={disabled}>
        <GlossSurface base={theme.color.accentSoft} radius={theme.radius.chip} bordered={false} style={styles.activeShell}>
          {text}
        </GlossSurface>
      </Pressable>
    )
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, styles.inactiveShell]}
    >
      {text}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 7,
    borderRadius: theme.radius.chip,
  },
  inactiveShell: {
    borderWidth: 1.5,
    borderColor: theme.color.line,
    backgroundColor: theme.color.field,
  },
  activeShell: {
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 7,
    borderWidth: 1.5,
    borderColor: theme.color.accentLine,
  },
  text: { fontSize: theme.text.sm },
  textInactive: { color: theme.color.ink2 },
  textActive: { color: theme.color.accentInk, fontWeight: theme.weight.bold },
})
