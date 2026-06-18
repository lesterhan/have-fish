import { type ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { theme } from '@/lib/theme'
import { alpha, darken, lighten } from '@/lib/color'

interface Props {
  /** Base color the gloss is mixed from. Defaults to the card surface. */
  base?: string
  /** Corner radius. Defaults to the card radius. */
  radius?: number
  /** Hairline border drawn from a darkened base. Default on. */
  bordered?: boolean
  /** Soft drop shadow / elevation. Default on. */
  elevated?: boolean
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}

/**
 * Neutral soft-gloss container — the workhorse surface of the Companion design:
 * cards, numpad keys, the gear button, sheets, active chips.
 *
 * Recreates the handoff "Gloss recipe → Neutral soft-gloss" with two stacked
 * gradients (a base light→dark fill + a white sheen overlay), a 1px top inset
 * highlight, a darkened hairline border, and a soft elevation. Purely visual —
 * wrap it in a `Pressable` for interactive surfaces (e.g. numpad keys).
 */
export function GlossSurface({
  base = theme.color.surface,
  radius = theme.radius.card,
  bordered = true,
  elevated = true,
  style,
  children,
}: Props) {
  return (
    <View
      style={[
        { borderRadius: radius },
        elevated && theme.gloss.shadowCard,
        bordered && { borderWidth: 1, borderColor: darken(base, 10) },
        style,
      ]}
    >
      {/* Gradient layers, clipped to the rounded rect. */}
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
        <LinearGradient
          colors={[lighten(base, 2), darken(base, 5)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[theme.gloss.neutralSheenTop, alpha(theme.color.field, 0)]}
          locations={[0, 0.6]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* 1px top inset highlight. */}
        <View style={[styles.insetTop, { backgroundColor: theme.gloss.neutralInsetTop }]} />
      </View>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  insetTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
})
