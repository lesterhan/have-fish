import { StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { theme } from '@/lib/theme'
import { initials } from '@/lib/initials'

interface Props {
  name: string | null | undefined
  /** Diameter. Design uses 28 / 30 / 32 across screens. */
  size?: number
  /** Selected = accent gloss fill + white initials. */
  selected?: boolean
}

/**
 * Member avatar — a circle of initials. Neutral by default (recessed surface +
 * ink initials, hairline border); selected renders the accent gloss with white
 * initials (used by the payer segment, selected balance member, etc.). Initials
 * are mono per the design.
 */
export function Avatar({ name, size = 32, selected = false }: Props) {
  const fontSize = Math.round(size * 0.4)
  const text = initials(name)

  return (
    <View
      style={[
        styles.base,
        { width: size, height: size, borderRadius: size / 2 },
        selected ? styles.selectedBorder : styles.neutralBorder,
      ]}
    >
      {selected && (
        <LinearGradient
          colors={[theme.color.accentGlossTop, theme.color.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
        />
      )}
      <Text
        style={[
          styles.initials,
          { fontSize },
          { color: selected ? theme.color.textOnAccent : theme.color.ink2 },
        ]}
      >
        {text}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: theme.color.surface2,
  },
  neutralBorder: { borderWidth: 1, borderColor: theme.color.line },
  selectedBorder: { borderWidth: 1, borderColor: theme.color.accentGlossBorder },
  initials: {
    fontFamily: theme.font.monoSemibold,
    fontWeight: theme.weight.semibold,
  },
})
