import { StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { theme } from '@/lib/theme'
import { alpha, darken, lighten } from '@/lib/color'

interface Props {
  /** Color the gloss is built from. For `accent`, pass the accent fill. */
  base: string
  /** Corner radius to clip the layers to (match the host's radius). */
  radius: number
  /** Accent gloss (button/pill): explicit rust gradient, no white sheen. */
  accent?: boolean
}

/**
 * The Companion "gloss recipe" as a single absolutely-positioned overlay — the
 * one place the layered-gradient sheen is defined. Hosts (cards, buttons, chips,
 * the gear) render their own box (bg + border + shadow) and drop this inside to
 * paint the gloss. Because it's absolute, it never affects the host's layout.
 *
 * Two flavors (handoff "Gloss recipe"):
 * - **neutral** (default): base light→dark fill + a white sheen + a 1px top
 *   inset highlight. Used on neutral surfaces and active chips.
 * - **accent**: the rust `accentGlossTop → base` gradient with the accent inset
 *   highlight and no sheen. Used on primary buttons / the currency pill.
 *
 * RN has no `color-mix`, so the lighten/darken stops are computed at runtime
 * (`lib/color`); the fixed sheen/inset values live in `theme.gloss`.
 */
export function GlossLayers({ base, radius, accent = false }: Props) {
  const baseColors: [string, string] = accent
    ? [theme.color.accentGlossTop, base]
    : [lighten(base, 2), darken(base, 5)]
  const insetColor = accent ? theme.gloss.accentInsetTop : theme.gloss.neutralInsetTop

  return (
    <View style={[styles.clip, { borderRadius: radius }]} pointerEvents="none">
      <LinearGradient
        colors={baseColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.fill}
      />
      {!accent && (
        <LinearGradient
          colors={[theme.gloss.neutralSheenTop, alpha(theme.color.field, 0)]}
          locations={[0, 0.6]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.fill}
        />
      )}
      <View style={[styles.insetTop, { backgroundColor: insetColor }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  clip: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  insetTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 1 },
})
