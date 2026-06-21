import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import {
  fetchAccounts,
  updateCategoryWeights,
  updateMemberWeight,
  type Account,
  type GroupCategory,
} from '@/lib/api'
import { useGroups } from '@/lib/group-context'
import {
  accountRows,
  activeCategories,
  baselineVector,
  categoryVector,
  groupCard,
  inheritsBaseline,
  splitRows,
  splitSummary,
  type WeightVector,
} from '@/lib/settings-view'
import { theme } from '@/lib/theme'
import { GlossButton } from '@/components/GlossButton'
import { GroupsSheet } from '@/components/GroupsSheet'
import { SettingsCard, SettingsRow } from '@/components/SettingsCard'
import { SplitSheet } from '@/components/SplitSheet'

/** Which split the bottom sheet is currently editing. */
type Editing = { kind: 'baseline' } | { kind: 'category'; category: GroupCategory } | null

/**
 * Group settings — the header gear's destination. Group-scoped only (app/device
 * settings live on the separate Account tab). Most config is read-only and
 * web-managed; the editable surfaces here are the split weights — the group
 * baseline and per-category overrides — each set through the shared slider
 * `SplitSheet`.
 */
export default function GroupSettingsScreen() {
  const router = useRouter()
  const { group, reloadData } = useGroups()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)

  // Accounts power the category → ledger-path display; refetch on focus so a
  // web-side mapping change shows up next time the screen is opened.
  useFocusEffect(
    useCallback(() => {
      fetchAccounts().then(setAccounts).catch(() => setAccounts([]))
    }, []),
  )

  async function saveBaseline(weights: WeightVector) {
    if (!group) return
    await Promise.all(weights.map((w) => updateMemberWeight(group.id, w.userId, w.weight)))
    await reloadData()
  }

  async function saveCategory(categoryId: string, weights: WeightVector) {
    if (!group) return
    await updateCategoryWeights(group.id, categoryId, weights)
    await reloadData()
  }

  const members = group?.members ?? []
  const editingCategory = editing?.kind === 'category' ? editing.category : null
  const categoryInherits = editingCategory != null && inheritsBaseline(editingCategory, members)

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Ionicons name="chevron-back" size={18} color={theme.color.accent} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.barTitle}>Group settings</Text>
        <View style={styles.back} />
      </View>

      {group == null ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No group selected.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Group summary */}
          {(() => {
            const card = groupCard(group)
            return (
              <SettingsCard title="Group">
                <SettingsRow label="Name" value={card.name} />
                <SettingsRow label="Default currency" value={card.currency} />
              </SettingsCard>
            )
          })()}

          {/* Baseline split — opens the slider sheet */}
          <SettingsCard title="Split" caption="The default split. Categories can override it below.">
            <Pressable style={styles.linkRow} onPress={() => setEditing({ kind: 'baseline' })}>
              <Text style={styles.linkValue} numberOfLines={1}>
                {splitSummary(splitRows(group.members))}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={theme.color.ink3} />
            </Pressable>
          </SettingsCard>

          {/* Per-category split overrides */}
          {activeCategories(group.categories).length > 0 && (
            <SettingsCard title="Category splits">
              {activeCategories(group.categories).map((c) => {
                const inherited = inheritsBaseline(c, group.members)
                return (
                  <Pressable
                    key={c.id}
                    style={styles.linkRow}
                    onPress={() => setEditing({ kind: 'category', category: c })}
                  >
                    <Text style={styles.linkLabel} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={[styles.badge, inherited ? styles.badgeMuted : styles.badgeCustom]}>
                      {inherited ? 'Baseline' : 'Custom'}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={theme.color.ink3} />
                  </Pressable>
                )
              })}
            </SettingsCard>
          )}

          {/* Category → account mappings (read-only) */}
          {accountRows(group.categories, accounts).length > 0 && (
            <SettingsCard
              title="Categories · posting accounts"
              caption="Category → account mappings are configured on the web app to keep entry fast here."
            >
              {accountRows(group.categories, accounts).map((r) => (
                <SettingsRow key={r.categoryId} label={r.name} value={r.accountPath ?? 'Set on web'} />
              ))}
            </SettingsCard>
          )}

          <GlossButton label="All groups" variant="neutral" onPress={() => setGroupsOpen(true)} />
        </ScrollView>
      )}

      <GroupsSheet visible={groupsOpen} onClose={() => setGroupsOpen(false)} />

      <SplitSheet
        visible={editing != null}
        title={editingCategory ? editingCategory.name : 'Split'}
        hint={
          editingCategory
            ? categoryInherits
              ? 'Inheriting the group baseline. Adjust to set a split just for this category.'
              : 'This category uses its own split.'
            : 'The default split applied when a category has no override.'
        }
        members={members}
        initial={editingCategory ? categoryVector(editingCategory, members) : baselineVector(members)}
        onClose={() => setEditing(null)}
        onSave={(weights) =>
          editingCategory ? saveCategory(editingCategory.id, weights) : saveBaseline(weights)
        }
        onClear={
          editingCategory && !categoryInherits ? () => saveCategory(editingCategory.id, []) : undefined
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.appBg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.sp.md,
    paddingVertical: theme.sp.sm,
    backgroundColor: theme.color.chrome,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.line,
  },
  back: { flexDirection: 'row', alignItems: 'center', minWidth: 64 },
  backText: { fontFamily: theme.font.sans, fontSize: 15, color: theme.color.accent },
  barTitle: { fontFamily: theme.font.serif, fontSize: 17, color: theme.color.ink },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: theme.font.mono, fontSize: 12, color: theme.color.ink3 },
  content: { padding: theme.sp.md, gap: theme.sp.md, paddingBottom: theme.sp.xl },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: theme.sp.sm, paddingVertical: theme.sp[13], minHeight: 44 },
  linkLabel: { flex: 1, fontFamily: theme.font.sans, fontSize: 14.5, color: theme.color.ink },
  linkValue: { flex: 1, fontFamily: theme.font.mono, fontSize: 13, color: theme.color.ink2 },
  badge: {
    fontFamily: theme.font.monoBold,
    fontSize: 9.5,
    letterSpacing: 0.4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    overflow: 'hidden',
  },
  badgeMuted: { backgroundColor: theme.color.surface2, color: theme.color.ink3 },
  badgeCustom: { backgroundColor: theme.color.accentSoft, color: theme.color.accentInk },
})
