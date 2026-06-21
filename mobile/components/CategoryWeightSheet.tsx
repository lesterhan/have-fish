import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { GroupCategory, GroupMember } from '@/lib/api'
import { categoryWeightRows, inheritsBaseline, percent } from '@/lib/settings-view'
import { theme } from '@/lib/theme'
import { BottomSheet } from './BottomSheet'
import { GlossButton } from './GlossButton'
import { Stepper } from './Stepper'

interface Props {
  visible: boolean
  category: GroupCategory | null
  members: GroupMember[]
  onClose: () => void
  /** Persist the vector (empty array clears the override → baseline fallback). */
  onSave: (categoryId: string, weights: { userId: string; weight: number }[]) => Promise<void>
}

/**
 * Per-category split-weight editor. Opens seeded from the category's override
 * (or the inherited baseline when it has none), lets each member's weight be
 * stepped, and shows the live percent share. "Save split" writes the full
 * vector; "Use baseline" clears the override so the split inherits the group
 * weights again.
 */
export function CategoryWeightSheet({ visible, category, members, onClose, onSave }: Props) {
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)

  // Re-seed whenever a different category opens.
  useEffect(() => {
    if (!visible || !category) return
    const seed: Record<string, number> = {}
    for (const r of categoryWeightRows(category, members)) seed[r.userId] = r.weight
    setWeights(seed)
  }, [visible, category, members])

  if (!category) return null

  const inherited = inheritsBaseline(category, members)
  const total = members.reduce((sum, m) => sum + (weights[m.userId] ?? 0), 0)

  async function persist(vector: { userId: string; weight: number }[]) {
    if (!category || busy) return
    setBusy(true)
    try {
      await onSave(category.id, vector)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={category.name}>
      <Text style={styles.hint}>
        {inherited
          ? 'Inheriting the group baseline. Adjust to set a split just for this category.'
          : 'This category uses its own split.'}
      </Text>

      <View style={styles.list}>
        {members.map((m) => {
          const w = weights[m.userId] ?? 1
          return (
            <View key={m.userId} style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {m.userName}
              </Text>
              <Text style={styles.pct}>{percent(w, total)}%</Text>
              <Stepper
                value={w}
                disabled={busy}
                onChange={(next) => setWeights((prev) => ({ ...prev, [m.userId]: next }))}
              />
            </View>
          )
        })}
      </View>

      <GlossButton
        label="Save split"
        disabled={busy}
        onPress={() => persist(members.map((m) => ({ userId: m.userId, weight: weights[m.userId] ?? 1 })))}
        style={styles.save}
      />
      {!inherited && (
        <GlossButton
          label="Use baseline"
          variant="neutral"
          disabled={busy}
          onPress={() => persist([])}
          style={styles.baseline}
        />
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
  list: { marginBottom: theme.sp.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.sm,
    paddingVertical: theme.sp[10],
    borderBottomWidth: 1,
    borderBottomColor: theme.color.lineSoft,
  },
  name: { flex: 1, fontFamily: theme.font.sans, fontSize: 14.5, color: theme.color.ink },
  pct: {
    minWidth: 44,
    textAlign: 'right',
    fontFamily: theme.font.mono,
    fontSize: 12,
    color: theme.color.ink3,
  },
  save: { marginTop: theme.sp.xs },
  baseline: { marginTop: theme.sp.sm },
})
