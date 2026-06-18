import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
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
  /** Long-pressing ⌫ clears the whole amount. */
  onClear: () => void
}

/**
 * Custom 3×4 amount numpad — the Add screen never raises the OS keyboard for the
 * amount. Each key is a neutral soft-gloss tile; press feedback nudges it down a
 * pixel and dims it slightly (handoff "Custom Numpad").
 *
 * Tactile feedback: a light `selection` tick on every key press; long-pressing
 * ⌫ clears the amount and fires a longer `warning` notification to mark the
 * larger action.
 */
export function Numpad({ onKey, onClear }: Props) {
  return (
    <View style={styles.grid}>
      {ROWS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((key) => (
            <NumpadButton
              key={key}
              value={key}
              onPress={() => onKey(key)}
              onLongPress={key === '⌫' ? onClear : undefined}
            />
          ))}
        </View>
      ))}
    </View>
  )
}

function NumpadButton({
  value,
  onPress,
  onLongPress,
}: {
  value: NumpadKey
  onPress: () => void
  onLongPress?: () => void
}) {
  const [pressed, setPressed] = useState(false)
  return (
    <Pressable
      onPress={onPress}
      // When a long press fires, RN suppresses the trailing onPress, so ⌫'s
      // single-delete never doubles up with the clear.
      onLongPress={
        onLongPress
          ? () => {
              // Longer/stronger feedback marks the destructive clear.
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
              onLongPress()
            }
          : undefined
      }
      onPressIn={() => {
        setPressed(true)
        // Subtle tactile tick on each key — the lightest haptic. Fire-and-forget;
        // ignore failures on devices without a haptic engine.
        Haptics.selectionAsync().catch(() => {})
      }}
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
