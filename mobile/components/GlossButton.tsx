import { useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { theme } from '@/lib/theme'
import { alpha, darken, lighten } from '@/lib/color'

type Variant = 'accent' | 'neutral'

interface Props {
  label: string
  onPress: () => void
  variant?: Variant
  disabled?: boolean
  /** Green "done" state — shows the label as success copy (e.g. "✓ Added"). */
  success?: boolean
  height?: number
  radius?: number
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
}

/**
 * Gloss button — the design's primary action surface.
 *
 * - `accent` (default): rust accent gloss, white text, used for Add / Record
 *   settlement / currency pill-style CTAs.
 * - `neutral`: neutral soft-gloss on a recessed base, ink text ("All groups").
 * - `disabled`: muted flat fill, faint text, no shadow.
 * - `success`: solid green confirmation flash (Epic 2 Add).
 *
 * Press feedback follows the handoff: `translateY(1px)` + a subtle dim.
 */
export function GlossButton({
  label,
  onPress,
  variant = 'accent',
  disabled = false,
  success = false,
  height = 50,
  radius = theme.radius.btn,
  style,
  textStyle,
}: Props) {
  const [pressed, setPressed] = useState(false)
  const interactive = !disabled && !success

  // Resolve the look: success > disabled > variant.
  const tone: 'success' | 'disabled' | Variant = success
    ? 'success'
    : disabled
      ? 'disabled'
      : variant

  const isFilled = tone === 'accent' || tone === 'success'
  const textColor =
    tone === 'disabled'
      ? theme.color.ink3
      : isFilled
        ? theme.color.textOnAccent
        : theme.color.ink

  return (
    <Pressable
      onPress={interactive ? onPress : undefined}
      onPressIn={() => interactive && setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={!interactive}
      style={[
        styles.base,
        { height, borderRadius: radius },
        tone === 'accent' && [theme.gloss.shadowButton, styles.accentBorder],
        tone === 'success' && styles.successFill,
        tone === 'neutral' && [theme.gloss.shadowCard, styles.neutralBorder],
        tone === 'disabled' && styles.disabledFill,
        pressed && interactive && styles.pressed,
        style,
      ]}
    >
      {/* Accent / neutral gloss gradient layers (filled tones draw their own). */}
      {tone === 'accent' && (
        <GradientLayers
          radius={radius}
          base={[theme.color.accentGlossTop, theme.color.accent]}
          insetTop={theme.gloss.accentInsetTop}
        />
      )}
      {tone === 'neutral' && (
        <GradientLayers
          radius={radius}
          base={[lighten(theme.color.surface2, 2), darken(theme.color.surface2, 5)]}
          sheen={theme.gloss.neutralSheenTop}
          insetTop={theme.gloss.neutralInsetTop}
        />
      )}

      <Text
        style={[
          styles.label,
          { color: textColor },
          isFilled && styles.labelShadow,
          textStyle,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>

      {pressed && interactive && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius, backgroundColor: alpha(theme.color.ink, 0.06) },
          ]}
        />
      )}
    </Pressable>
  )
}

/** The two stacked gloss gradients + top inset highlight, clipped to `radius`. */
function GradientLayers({
  radius,
  base,
  sheen,
  insetTop,
}: {
  radius: number
  base: [string, string]
  sheen?: string
  insetTop: string
}) {
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      <LinearGradient
        colors={base}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {sheen && (
        <LinearGradient
          colors={[sheen, alpha(theme.color.field, 0)]}
          locations={[0, 0.6]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[styles.insetTop, { backgroundColor: insetTop }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.sp.md,
  },
  accentBorder: { borderWidth: 1, borderColor: theme.color.accentGlossBorder },
  neutralBorder: { borderWidth: 1, borderColor: theme.color.line },
  successFill: { backgroundColor: theme.color.green },
  disabledFill: { backgroundColor: theme.color.surface2 },
  pressed: { transform: [{ translateY: 1 }] },
  label: {
    fontFamily: theme.font.sans,
    fontSize: 15,
    fontWeight: theme.weight.bold,
  },
  labelShadow: {
    textShadowColor: theme.gloss.accentTextShadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  insetTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 1 },
})
