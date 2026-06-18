import { type ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { theme } from '@/lib/theme'
import { darken } from '@/lib/color'
import { GlossLayers } from './GlossLayers'

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
 * cards, the gear button, group rows, active chips' backdrop, etc.
 *
 * Owns the box (solid base bg + darkened hairline border + soft elevation) and
 * drops a {@link GlossLayers} overlay inside to paint the sheen. Purely visual —
 * wrap it in a `Pressable` for interactive surfaces.
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
        // Solid base behind the gradient so Android renders the elevation
        // shadow (a transparent elevated View casts none).
        { borderRadius: radius, backgroundColor: base },
        elevated && theme.gloss.shadowCard,
        bordered && { borderWidth: 1, borderColor: darken(base, 10) },
        style,
      ]}
    >
      <GlossLayers base={base} radius={radius} />
      {children}
    </View>
  )
}
