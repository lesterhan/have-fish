import { Pressable, StyleSheet, Text } from 'react-native'
import { theme } from '@/lib/theme'

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
 * `accentSoft` fill + 1.5px `accentLine` border, `accentInk`.
 *
 * Both states share one box and one font family/weight so the chip does **not**
 * resize or shift its glyph metrics on toggle — only the colors change. (The
 * design's selected-chip weight bump is dropped on purpose: swapping the mono
 * face Regular→Bold changed the chip's width on every tap.)
 */
export function Chip({ label, active = false, onPress, disabled = false, mono = true }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, active ? styles.active : styles.inactive]}
    >
      <Text
        style={[
          styles.text,
          { fontFamily: mono ? theme.font.monoMedium : theme.font.sans },
          active ? styles.textActive : styles.textInactive,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: theme.sp.sm,
    paddingVertical: 7,
    borderRadius: theme.radius.chip,
    borderWidth: 1.5,
  },
  inactive: { borderColor: theme.color.line, backgroundColor: theme.color.field },
  active: { borderColor: theme.color.accentLine, backgroundColor: theme.color.accentSoft },
  text: { fontSize: theme.text.sm, fontWeight: theme.weight.medium },
  textInactive: { color: theme.color.ink2 },
  textActive: { color: theme.color.accentInk },
})
