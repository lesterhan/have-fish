import { useMemo, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
} from 'react-native'
import type { Account } from '@/lib/api'
import { theme } from '@/lib/theme'

interface Props {
  accounts: Account[]
  /** Currently-selected account id, or '' for none. */
  selectedId: string
  onSelect: (id: string) => void
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string
  /** Shown above the trigger. */
  label?: string
}

// Show the account name when set, otherwise the last path segment, with the
// full colon-path as a dimmer subtitle so deep accounts stay distinguishable.
function accountLabel(a: Account): string {
  if (a.name && a.name.trim()) return a.name
  const segments = a.path.split(':')
  return segments[segments.length - 1] || a.path
}

/**
 * Lightweight account picker — a tap target that opens a searchable modal list.
 *
 * Mobile-revival story 3. Lists the caller's own active accounts (the caller
 * filters/sorts before passing them in). Used by the expense form to choose the
 * payment account; reusable for any account-selection slot.
 */
export function AccountPicker({ accounts, selectedId, onSelect, placeholder = 'Select account', label }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedId) ?? null,
    [accounts, selectedId],
  )

  // Sort by path so sibling accounts cluster; filter by case-insensitive
  // substring over both path and name.
  const filtered = useMemo(() => {
    const sorted = [...accounts].sort((a, b) => a.path.localeCompare(b.path))
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (a) => a.path.toLowerCase().includes(q) || (a.name ?? '').toLowerCase().includes(q),
    )
  }, [accounts, query])

  function choose(id: string) {
    onSelect(id)
    setOpen(false)
    setQuery('')
  }

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)}>
        <Text style={[styles.triggerText, !selected && styles.triggerPlaceholder]} numberOfLines={1}>
          {selected ? accountLabel(selected) : placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>
      {selected && (selected.name?.trim() || selected.path !== accountLabel(selected)) ? (
        <Text style={styles.triggerSubtitle} numberOfLines={1}>
          {selected.path}
        </Text>
      ) : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label ?? 'Select account'}</Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Text style={styles.cancel}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search accounts"
              placeholderTextColor={theme.color.textDisabled}
              autoCorrect={false}
              autoCapitalize="none"
            />

            <FlatList
              data={filtered}
              keyExtractor={(a) => a.id}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.row, item.id === selectedId && styles.rowSelected]}
                  onPress={() => choose(item.id)}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowName}>{accountLabel(item)}</Text>
                    <Text style={styles.rowPath} numberOfLines={1}>
                      {item.path}
                    </Text>
                  </View>
                  {item.id === selectedId ? <Text style={styles.check}>✓</Text> : null}
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.empty}>No matching accounts</Text>}
            />
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  label: {
    fontSize: theme.text.sm,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
    marginBottom: 4,
    marginTop: theme.sp.xs,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.windowInset,
    borderWidth: 1,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.lg,
    padding: theme.sp.sm,
  },
  triggerText: { flex: 1, fontSize: theme.text.base, color: theme.color.text },
  triggerPlaceholder: { color: theme.color.textDisabled },
  triggerSubtitle: {
    fontSize: theme.text.xs,
    color: theme.color.textMuted,
    marginTop: 3,
    marginLeft: 2,
  },
  chevron: { fontSize: theme.text.xs, color: theme.color.textMuted, marginLeft: theme.sp.xs },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.color.window,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    padding: theme.sp.lg,
    paddingBottom: theme.sp.lg,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: theme.color.rule,
    borderRadius: theme.radius.lg,
    alignSelf: 'center',
    marginBottom: theme.sp.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.sp.sm,
  },
  sheetTitle: {
    fontSize: theme.text.lg,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
  },
  cancel: { fontSize: theme.text.base, color: theme.color.accent },
  search: {
    backgroundColor: theme.color.windowInset,
    borderWidth: 1,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.sp.sm,
    paddingVertical: theme.sp.sm,
    fontSize: theme.text.base,
    marginBottom: theme.sp.xs,
  },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.sp.sm,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.ruleSoft,
  },
  rowSelected: { backgroundColor: theme.color.accentChipBg },
  rowText: { flex: 1 },
  rowName: { fontSize: theme.text.base, color: theme.color.text, fontWeight: theme.weight.medium },
  rowPath: { fontSize: theme.text.xs, color: theme.color.textMuted, marginTop: 2 },
  check: { fontSize: theme.text.base, color: theme.color.accent, marginLeft: theme.sp.xs },
  empty: { padding: theme.sp.lg, color: theme.color.textMuted, textAlign: 'center' },
})
