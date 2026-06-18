import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native'
import { theme } from '@/lib/theme'

interface Props {
  children: string
  style?: StyleProp<TextStyle>
}

/**
 * The recurring uppercase mono caption used as a section/field heading
 * throughout the Companion screens (AMOUNT, PAID BY, TO SETTLE, EXPENSES …).
 * Mono 10.5 / 700, letter-spacing 1.3, `ink2`.
 */
export function Label({ children, style }: Props) {
  return <Text style={[styles.label, style]}>{children.toUpperCase()}</Text>
}

const styles = StyleSheet.create({
  label: {
    fontFamily: theme.font.monoBold,
    fontWeight: theme.weight.bold,
    fontSize: 10.5,
    letterSpacing: 1.3,
    color: theme.color.ink2,
  },
})
