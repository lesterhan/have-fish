import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Slider from '@react-native-community/slider'
import type { GroupMember } from '@/lib/api'
import { pctToVector, weightsToPct, type WeightVector } from '@/lib/settings-view'
import { theme } from '@/lib/theme'
import { BottomSheet } from './BottomSheet'
import { GlossButton } from './GlossButton'

interface Props {
  visible: boolean
  title: string
  /** Fine print under the title (e.g. inherited-baseline note). */
  hint?: string
  members: GroupMember[]
  /** Starting vector covering both members (baseline or a category override). */
  initial: WeightVector
  onClose: () => void
  /** Persist the chosen two-member vector. */
  onSave: (weights: WeightVector) => Promise<void>
  /** When set, shows a "Use baseline" action (clears a category override). */
  onClear?: () => Promise<void>
}

/**
 * Reusable split editor — a bottom sheet with a single 1–99% slider for the
 * first member (the second takes the remainder), mirroring the web's two-member
 * weight control. Used for both the group baseline and per-category overrides.
 *
 * Splits are a two-member concept here (groups are ~2); for any other size the
 * sheet shows a "manage on the web app" note instead of inventing a multi-member
 * control — same stance as the web UI.
 */
export function SplitSheet({ visible, title, hint, members, initial, onClose, onSave, onClear }: Props) {
  const twoMember = members.length === 2
  const [pct, setPct] = useState(50)
  const [busy, setBusy] = useState(false)

  // Re-seed from the incoming vector each time the sheet opens.
  useEffect(() => {
    if (!visible || !twoMember) return
    setPct(weightsToPct(initial, members[0].userId, members[1].userId) ?? 50)
  }, [visible, twoMember, initial, members])

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await action()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {hint != null && <Text style={styles.hint}>{hint}</Text>}

      {!twoMember ? (
        <Text style={styles.note}>
          Splits across {members.length === 1 ? 'a single member' : `${members.length} members`} are
          managed on the web app.
        </Text>
      ) : (
        <>
          <View style={styles.legend}>
            <Text style={styles.legendName} numberOfLines={1}>
              {members[0].userName} <Text style={styles.legendPct}>{Math.round(pct)}%</Text>
            </Text>
            <Text style={[styles.legendName, styles.legendRight]} numberOfLines={1}>
              <Text style={styles.legendPct}>{100 - Math.round(pct)}%</Text> {members[1].userName}
            </Text>
          </View>

          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={99}
            step={1}
            value={pct}
            disabled={busy}
            onValueChange={setPct}
            minimumTrackTintColor={theme.color.accent}
            maximumTrackTintColor={theme.color.line}
            thumbTintColor={theme.color.accent}
          />

          <GlossButton
            label="Save split"
            disabled={busy}
            onPress={() => run(() => onSave(pctToVector(pct, members[0].userId, members[1].userId)))}
            style={styles.save}
          />
          {onClear != null && (
            <GlossButton
              label="Use baseline"
              variant="neutral"
              disabled={busy}
              onPress={() => run(onClear)}
              style={styles.baseline}
            />
          )}
        </>
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  hint: { fontFamily: theme.font.mono, fontSize: 11, lineHeight: 16, color: theme.color.ink3, marginBottom: theme.sp.sm },
  note: { fontFamily: theme.font.mono, fontSize: 12, lineHeight: 18, color: theme.color.ink2, paddingVertical: theme.sp.sm },
  legend: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.sp.sm, marginBottom: theme.sp.xs },
  legendName: { flex: 1, fontFamily: theme.font.sans, fontSize: 14.5, color: theme.color.ink },
  legendRight: { textAlign: 'right' },
  legendPct: { fontFamily: theme.font.monoBold, color: theme.color.accentInk },
  slider: { width: '100%', height: 40, marginBottom: theme.sp.sm },
  save: { marginTop: theme.sp.xs },
  baseline: { marginTop: theme.sp.sm },
})
