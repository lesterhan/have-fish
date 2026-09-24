import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { GroupMember } from '@/lib/api'
import { pctToVector, type WeightVector, weightsToPct } from '@/lib/settings-view'
import { theme } from '@/lib/theme'
import { BottomSheet } from './BottomSheet'
import { GlossButton } from './GlossButton'
import { WeightSlider } from './WeightSlider'

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
  onClear?: (() => Promise<void>) | undefined
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
export function SplitSheet({
  visible,
  title,
  hint,
  members,
  initial,
  onClose,
  onSave,
  onClear,
}: Props) {
  // `pair` is the same statement `members.length === 2` was making, in a form the compiler
  // follows into the branch that needs it — the four reads below used to restate it.
  const [first, second] = members
  const pair =
    first !== undefined && second !== undefined && members.length === 2 ? { first, second } : null
  const [pct, setPct] = useState(50)
  const [busy, setBusy] = useState(false)
  const seeded = useRef(false)

  // Seed once per open, snapped onto the slider's 5% grid. Seeding only on the
  // open edge (not on every `initial` change) avoids a flicker on save: the
  // post-save reload would otherwise re-seed from the stale category snapshot
  // still held in the parent's `editing` state, snapping the thumb back briefly.
  useEffect(() => {
    if (!visible) {
      seeded.current = false
      return
    }
    if (seeded.current) return
    // Read the pair inside rather than closing over the one built for rendering: that one
    // is a fresh object every render, so depending on it would re-run this effect — and
    // this effect sets state.
    const [a, b] = members
    if (a === undefined || b === undefined || members.length !== 2) return
    seeded.current = true
    const value = weightsToPct(initial, a.userId, b.userId) ?? 50
    setPct(Math.min(95, Math.max(5, Math.round(value / 5) * 5)))
  }, [visible, initial, members])

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

      {pair === null ? (
        <Text style={styles.note}>
          Splits across {members.length === 1 ? 'a single member' : `${members.length} members`} are
          managed on the web app.
        </Text>
      ) : (
        <>
          <View style={styles.legend}>
            <Text style={styles.legendName} numberOfLines={1}>
              {pair.first.userName} <Text style={styles.legendPct}>{Math.round(pct)}%</Text>
            </Text>
            <Text style={[styles.legendName, styles.legendRight]} numberOfLines={1}>
              <Text style={styles.legendPct}>{100 - Math.round(pct)}%</Text> {pair.second.userName}
            </Text>
          </View>

          <View style={styles.slider}>
            <WeightSlider value={pct} onChange={setPct} disabled={busy} />
          </View>

          <GlossButton
            label="Save split"
            disabled={busy}
            onPress={() =>
              run(() => onSave(pctToVector(pct, pair.first.userId, pair.second.userId)))
            }
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
  hint: {
    fontFamily: theme.font.mono,
    fontSize: 11,
    lineHeight: 16,
    color: theme.color.ink3,
    marginBottom: theme.sp.sm,
  },
  note: {
    fontFamily: theme.font.mono,
    fontSize: 12,
    lineHeight: 18,
    color: theme.color.ink2,
    paddingVertical: theme.sp.sm,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.sp.sm,
    marginBottom: theme.sp.xs,
  },
  legendName: { flex: 1, fontFamily: theme.font.sans, fontSize: 14.5, color: theme.color.ink },
  legendRight: { textAlign: 'right' },
  legendPct: { fontFamily: theme.font.monoBold, color: theme.color.accentInk },
  slider: { width: '100%', height: 40, marginBottom: theme.sp.sm },
  save: { marginTop: theme.sp.xs },
  baseline: { marginTop: theme.sp.sm },
})
