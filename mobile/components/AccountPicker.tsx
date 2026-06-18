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
              placeholderTextColor="#aaa"
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
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 4, marginTop: 8 },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 6,
    padding: 10,
  },
  triggerText: { flex: 1, fontSize: 15, color: '#1a1a1a' },
  triggerPlaceholder: { color: '#aaa' },
  triggerSubtitle: { fontSize: 12, color: '#888', marginTop: 3, marginLeft: 2 },
  chevron: { fontSize: 12, color: '#888', marginLeft: 8 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 24,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  cancel: { fontSize: 15, color: '#2563eb' },
  search: {
    backgroundColor: '#f2f3f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 8,
  },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  rowSelected: { backgroundColor: '#eff6ff' },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  rowPath: { fontSize: 12, color: '#888', marginTop: 2 },
  check: { fontSize: 16, color: '#2563eb', marginLeft: 10 },
  empty: { padding: 24, color: '#888', textAlign: 'center' },
})
