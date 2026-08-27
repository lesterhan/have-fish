import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useShellMode } from '@/lib/shell-mode-context'
import { SHELL_MODES, accentFor, homeRouteFor, modeLabel, type ShellMode } from '@/lib/shell-mode'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { GlossLayers } from './GlossLayers'

/**
 * The two-ledger switch in the shell header — Group | Cash.
 *
 * Always visible, on every screen of both modes. That is the point: a spend
 * entered in the wrong ledger is silently wrong (a personal cash purchase logged
 * as a group expense bills half of it to somebody else), so which ledger you are
 * in has to be readable without navigating anywhere or remembering anything.
 *
 * The selected side is filled in that mode's own accent — rust for Group, denim
 * for Cash — so the control doubles as the legend for the accent colour used
 * across the rest of the screen.
 *
 * Switching hides the tab you were standing on, so it also navigates to the new
 * mode's entry tab; without that Expo Router would be left focused on a route
 * with no href.
 */
export function ModeSwitch() {
  const { mode, setMode } = useShellMode()
  const router = useRouter()

  function select(next: ShellMode) {
    if (next === mode) return
    haptics.selection()
    setMode(next)
    router.replace(homeRouteFor(next))
  }

  return (
    <View style={styles.track}>
      {SHELL_MODES.map((m) => {
        const active = m === mode
        const accent = accentFor(m)
        return (
          <Pressable
            key={m}
            onPress={() => select(m)}
            hitSlop={4}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${modeLabel(m)} ledger`}
            style={[
              styles.segment,
              active
                ? { backgroundColor: accent.soft, borderColor: accent.line }
                : styles.inactive,
            ]}
          >
            {active && <GlossLayers base={accent.soft} radius={theme.radius.chip} />}
            <Text
              style={[styles.label, { color: active ? accent.ink : theme.color.ink3 }]}
              numberOfLines={1}
            >
              {modeLabel(m)}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: theme.sp[4],
    padding: 2,
    borderRadius: theme.radius.field,
    backgroundColor: theme.color.surface2,
    borderWidth: 1,
    borderColor: theme.color.lineSoft,
  },
  segment: {
    paddingHorizontal: theme.sp[10],
    paddingVertical: 5,
    borderRadius: theme.radius.chip,
    borderWidth: 1,
    overflow: 'hidden',
  },
  // Both states carry a border so the segment never resizes on toggle.
  inactive: { borderColor: 'transparent', backgroundColor: 'transparent' },
  label: {
    fontSize: theme.text.xs,
    fontWeight: theme.weight.semibold,
  },
})
