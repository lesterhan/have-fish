import { Pressable, StyleSheet, Text, View } from 'react-native'
import { theme } from '@/lib/theme'
import * as haptics from '@/lib/haptics'

interface Props {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  disabled?: boolean
}

/**
 * Compact `−  n  +` integer stepper for split weights. Clamps to `[min, max]`
 * and buzzes on each step. Neutral gloss-card styling to match the settings
 * surfaces; purely local — the caller persists the new value.
 */
export function Stepper({ value, onChange, min = 1, max = 99, disabled = false }: Props) {
  function step(delta: number) {
    const next = Math.min(max, Math.max(min, value + delta))
    if (next === value) return
    haptics.selection()
    onChange(next)
  }

  return (
    <View style={styles.row}>
      <Button label="−" onPress={() => step(-1)} disabled={disabled || value <= min} />
      <Text style={styles.value}>{value}</Text>
      <Button label="+" onPress={() => step(1)} disabled={disabled || value >= max} />
    </View>
  )
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        pressed && !disabled && styles.btnPressed,
        disabled && styles.btnDisabled,
      ]}
    >
      <Text style={[styles.btnText, disabled && styles.btnTextDisabled]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.xs },
  value: {
    minWidth: 22,
    textAlign: 'center',
    fontFamily: theme.font.monoSemibold,
    fontSize: 14,
    color: theme.color.ink,
  },
  btn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.surface2,
  },
  btnPressed: { backgroundColor: theme.color.accentSoft, borderColor: theme.color.accentLine },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontFamily: theme.font.monoBold, fontSize: 16, lineHeight: 18, color: theme.color.ink2 },
  btnTextDisabled: { color: theme.color.ink3 },
})
