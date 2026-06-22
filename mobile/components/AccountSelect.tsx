import { useEffect, useMemo, useState } from 'react'
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { createAccount, type Account } from '@/lib/api'
import {
  ROOTS,
  accountLeaf,
  createSuggestion,
  filterAccounts,
  type Root,
} from '@/lib/account-search'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { BottomSheet } from './BottomSheet'
import { GlossSurface } from './GlossSurface'

interface Props {
  /** The caller's own active accounts. Newly-created accounts are merged in
   *  locally so selection works even before the parent refetches. */
  accounts: Account[]
  /** Currently-selected account id, or '' for none. */
  selectedId: string
  onSelect: (id: string) => void
  /** Fired when an account is created inline, so the parent can fold it into
   *  its own list / refetch. The created account is already auto-selected. */
  onCreate?: (account: Account) => void
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string
  /** Shown above the trigger and as the sheet title. */
  label?: string
  /**
   * When provided, the sheet's open state is *controlled* by the parent and the
   * built-in trigger is not rendered — the parent supplies its own trigger (e.g.
   * the PaymentRow account chip). Omit both for the default self-triggering mode.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Account selector + inline creator for the Companion app — a tap target that
 * opens a {@link BottomSheet} with root-type scope chips, a fuzzy search field,
 * and an inline "create" row when no account matches. Replaces the old flat
 * `AccountPicker`; mirrors the web `AccountPathInput` interaction model where it
 * translates to touch.
 *
 * All search / create logic lives in the RN-free `lib/account-search` helper;
 * this component is the rendering + I/O shell. Serves expense-entry and
 * settlement account slots, and the future category-settings page.
 */
export function AccountSelect({
  accounts,
  selectedId,
  onSelect,
  onCreate,
  placeholder = 'Select account',
  label,
  open,
  onOpenChange,
}: Props) {
  const controlled = open !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const sheetOpen = controlled ? (open as boolean) : internalOpen
  const [query, setQuery] = useState('')
  const [root, setRoot] = useState<Root | null>(null)
  const [created, setCreated] = useState<Account[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setOpen(next: boolean) {
    if (controlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }

  // Reset the in-sheet search/scope/error whenever the sheet opens, so both the
  // self-triggered and parent-controlled paths start from a clean filter state.
  useEffect(() => {
    if (sheetOpen) {
      setQuery('')
      setRoot(null)
      setError(null)
    }
  }, [sheetOpen])

  // Created accounts merged in so the trigger label and selection resolve even
  // before the parent passes them back down.
  const allAccounts = useMemo(() => [...accounts, ...created], [accounts, created])

  const selected = useMemo(
    () => allAccounts.find((a) => a.id === selectedId) ?? null,
    [allAccounts, selectedId],
  )

  const filtered = useMemo(
    () => filterAccounts(allAccounts, query, root ?? undefined),
    [allAccounts, query, root],
  )

  const suggestion = useMemo(
    () => createSuggestion(allAccounts, query, root ?? undefined),
    [allAccounts, query, root],
  )

  function choose(id: string) {
    onSelect(id)
    setOpen(false)
  }

  async function handleCreate(path: string) {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const account = await createAccount({ path })
      setCreated((prev) => [...prev, account])
      onCreate?.(account)
      choose(account.id)
    } catch (e: any) {
      setError(e?.message ?? 'Could not create account')
    } finally {
      setCreating(false)
    }
  }

  const triggerSub = selected && (selected.name?.trim() || accountLeaf(selected) !== selected.path)

  return (
    <View>
      {!controlled && (
        <>
          {label != null && <Text style={styles.label}>{label}</Text>}
          <Pressable style={styles.trigger} onPress={() => setOpen(true)} onPressIn={haptics.selection}>
            <Text
              style={[styles.triggerText, !selected && styles.triggerPlaceholder]}
              numberOfLines={1}
            >
              {selected ? accountLeaf(selected) : placeholder}
            </Text>
            <Text style={styles.chevron}>▾</Text>
          </Pressable>
          {triggerSub ? (
            <Text style={styles.triggerSub} numberOfLines={1}>
              {selected!.path}
            </Text>
          ) : null}
        </>
      )}

      <BottomSheet visible={sheetOpen} onClose={() => setOpen(false)} title={label ?? 'Select account'}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          {[null, ...ROOTS].map((r) => {
            const active = r === root
            return (
              <Pressable
                key={r ?? 'all'}
                onPress={() => {
                  haptics.selection()
                  setRoot(r)
                }}
              >
                <GlossSurface
                  base={active ? theme.color.accentSoft : theme.color.surface2}
                  radius={theme.radius.chip}
                  elevated={false}
                  style={styles.chip}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {r ?? 'All'}
                  </Text>
                </GlossSurface>
              </Pressable>
            )
          })}
        </ScrollView>

        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder={root ? `Search or create under ${root}…` : 'Search or type a new path…'}
          placeholderTextColor={theme.color.ink3}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!creating}
        />

        {error != null && <Text style={styles.error}>{error}</Text>}

        <FlatList
          data={filtered}
          keyExtractor={(a) => a.id}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          renderItem={({ item }) => {
            const isSel = item.id === selectedId
            return (
              <Pressable
                style={[styles.row, isSel && styles.rowSelected]}
                onPress={() => choose(item.id)}
                onPressIn={haptics.selection}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{accountLeaf(item)}</Text>
                  <Text style={styles.rowPath} numberOfLines={1}>
                    {item.path}
                  </Text>
                </View>
                {isSel ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            )
          }}
          ListFooterComponent={
            suggestion ? (
              <Pressable
                style={styles.createRow}
                onPress={() => handleCreate(suggestion.path)}
                onPressIn={haptics.selection}
                disabled={creating}
              >
                <Text style={styles.createPlus}>＋</Text>
                <Text style={styles.createText} numberOfLines={1}>
                  {creating ? 'Creating…' : `Create '${suggestion.path}'`}
                </Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            suggestion ? null : <Text style={styles.empty}>No matching accounts</Text>
          }
        />
      </BottomSheet>
    </View>
  )
}

const styles = StyleSheet.create({
  label: {
    fontFamily: theme.font.sans,
    fontSize: theme.text.sm,
    fontWeight: theme.weight.semibold,
    color: theme.color.ink,
    marginBottom: 4,
    marginTop: theme.sp.xs,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.field,
    borderWidth: 1,
    borderColor: theme.color.line,
    borderRadius: theme.radius.field,
    paddingHorizontal: theme.sp.sm,
    height: 44,
  },
  triggerText: { flex: 1, fontSize: theme.text.base, color: theme.color.ink },
  triggerPlaceholder: { color: theme.color.ink3 },
  triggerSub: {
    fontFamily: theme.font.mono,
    fontSize: theme.text.xs,
    color: theme.color.ink2,
    marginTop: 3,
    marginLeft: 2,
  },
  chevron: { fontSize: theme.text.xs, color: theme.color.ink2, marginLeft: theme.sp.xs },

  chipsScroll: { flexGrow: 0, marginBottom: theme.sp.sm },
  chips: { gap: theme.sp.xs, paddingRight: theme.sp.xs },
  chip: { paddingHorizontal: theme.sp.sm, paddingVertical: theme.sp[7] },
  chipText: { fontFamily: theme.font.monoMedium, fontSize: theme.text.sm, color: theme.color.ink2 },
  chipTextActive: { color: theme.color.accentInk },

  search: {
    backgroundColor: theme.color.field,
    borderWidth: 1,
    borderColor: theme.color.line,
    borderRadius: theme.radius.field,
    paddingHorizontal: theme.sp.sm,
    height: 44,
    fontSize: theme.text.base,
    color: theme.color.ink,
    marginBottom: theme.sp.xs,
  },
  error: {
    fontFamily: theme.font.sans,
    fontSize: theme.text.sm,
    color: theme.color.red,
    marginBottom: theme.sp.xs,
  },
  list: { flexGrow: 0, maxHeight: 320 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.xs,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.lineSoft,
  },
  rowSelected: { backgroundColor: theme.color.accentSoft },
  rowText: { flex: 1 },
  rowName: {
    fontFamily: theme.font.sans,
    fontSize: theme.text.base,
    color: theme.color.ink,
    fontWeight: theme.weight.medium,
  },
  rowPath: { fontFamily: theme.font.mono, fontSize: theme.text.xs, color: theme.color.ink2, marginTop: 2 },
  check: { fontSize: theme.text.base, color: theme.color.accent, marginLeft: theme.sp.xs },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.sp.xs,
    paddingVertical: theme.sp.sm,
    paddingHorizontal: theme.sp.xs,
  },
  createPlus: { fontSize: theme.text.lg, color: theme.color.accent },
  createText: {
    flex: 1,
    fontFamily: theme.font.mono,
    fontSize: theme.text.sm,
    color: theme.color.accentInk,
  },
  empty: { padding: theme.sp.lg, color: theme.color.ink2, textAlign: 'center' },
})
