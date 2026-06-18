import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { theme } from '@/lib/theme'
import { GlossLayers } from './GlossLayers'

/** A numpad key: a digit, the decimal point, or backspace. */
export type NumpadKey =
  | '1' | '2' | '3'
  | '4' | '5' | '6'
  | '7' | '8' | '9'
  | '.' | '0' | '⌫'

const ROWS: NumpadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '⌫'],
]

const KEY_HEIGHT = 46

interface Props {
  /** Fired with the pressed key. The parent owns the amount input model. */
  onKey: (key: NumpadKey) => void
}

/**
 * Custom 3×4 amount numpad — the Add screen never raises the OS keyboard for the
 * amount. Each key is a neutral soft-gloss tile; press feedback nudges it down a
 * pixel and dims it slightly (handoff "Custom Numpad").
 */
export function Numpad({ onKey }: Props) {
  return (
    <View style={styles.grid}>
      {ROWS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((key) => (
            <NumpadButton key={key} value={key} onPress={() => onKey(key)} />
          ))}
        </View>
      ))}
    </View>
  )
}

function NumpadButton({ value, onPress }: { value: NumpadKey; onPress: () => void }) {
  const [pressed, setPressed] = useState(false)
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.key, pressed && styles.keyPressed]}
    >
      <GlossLayers base={theme.color.surface} radius={theme.radius.field} />
      <Text style={[styles.keyText, value === '⌫' && styles.backspaceText]}>{value}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  grid: {
    gap: theme.sp[7],
  },
  row: {
    flexDirection: 'row',
    gap: theme.sp[7],
  },
  key: {
    // Three equal-width keys per row; the row's two 7px gaps do the spacing.
    flex: 1,
    height: KEY_HEIGHT,
    borderRadius: theme.radius.field,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.line,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...theme.gloss.shadowCard,
  },
  keyPressed: {
    transform: [{ translateY: 1 }],
    opacity: 0.97,
  },
  keyText: {
    fontFamily: theme.font.monoSemibold,
    fontSize: 22,
    color: theme.color.ink,
  },
  backspaceText: {
    fontSize: 19,
  },
})
