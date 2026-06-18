import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { theme } from '@/lib/theme'
import { alpha, darken, lighten } from '@/lib/color'

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
 * neutral soft-gloss on `accentSoft` + 1.5px `accentLine` border, `accentInk`.
 *
 * Both states share one box and one font family/weight so the chip never resizes
 * or shifts its glyph metrics on toggle. The active gloss is an absolutely-
 * positioned overlay (no layout impact); the selected-weight bump from the
 * handoff is dropped because swapping the mono face Regular→Bold changed width.
 */
export function Chip({ label, active = false, onPress, disabled = false, mono = true }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, active ? styles.active : styles.inactive]}
    >
      {active && (
        <View style={[styles.gloss, { borderRadius: theme.radius.chip }]}>
          <LinearGradient
            colors={[lighten(theme.color.accentSoft, 2), darken(theme.color.accentSoft, 5)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.fill}
          />
          <LinearGradient
            colors={[theme.gloss.neutralSheenTop, alpha(theme.color.field, 0)]}
            locations={[0, 0.6]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.fill}
          />
          <View style={[styles.insetTop, { backgroundColor: theme.gloss.neutralInsetTop }]} />
        </View>
      )}
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
    overflow: 'hidden',
  },
  inactive: { borderColor: theme.color.line, backgroundColor: theme.color.field },
  active: { borderColor: theme.color.accentLine, backgroundColor: theme.color.accentSoft },
  gloss: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  insetTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 1 },
  text: { fontSize: theme.text.sm, fontWeight: theme.weight.medium },
  textInactive: { color: theme.color.ink2 },
  textActive: { color: theme.color.accentInk },
})
