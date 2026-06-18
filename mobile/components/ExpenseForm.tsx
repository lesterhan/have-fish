import { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createExpense, fetchAccounts, type Account, type ExpenseGroup, type GroupMember } from '@/lib/api'
import { getEmail } from '@/lib/auth'
import { AccountPicker } from './AccountPicker'
import { Chip } from './Chip'
import { Button } from './Button'
import { theme, cardStyle } from '@/lib/theme'

interface Props {
  group: ExpenseGroup
  onExpenseAdded: () => void
}

const LAST_CURRENCY_KEY = (groupId: string) => `havefish_last_currency_${groupId}`
const LAST_DESC_KEY = (groupId: string) => `havefish_last_desc_${groupId}`
const LAST_CATEGORY_KEY = (groupId: string) => `havefish_last_category_${groupId}`

/**
 * Expense entry form — Tab 1 on the group detail screen.
 *
 * Travel convenience features implemented here:
 * - Smart currency default: remembers last-used currency per group
 * - Quick repeat: "Again" chip pre-fills last description
 * - Share-weight persistence: slider position saved locally per group
 *
 * TODO:
 * - Replace plain TextInput date with a proper DateTimePicker sheet
 * - Add a currency picker (bottom sheet with common currencies + freetext)
 * - Offline: when createExpense throws a network error, show a "queued" state
 *   instead of a hard error (the queue is managed in lib/api.ts already)
 */
export function ExpenseForm({ group, onExpenseAdded }: Props) {
  const today = new Date().toISOString().split('T')[0]

  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(today)
  const [currency, setCurrency] = useState(group.defaultCurrency ?? 'CAD')
  const [paidByUserId, setPaidByUserId] = useState<string>(
    group.members[0]?.userId ?? '',
  )
  const [accounts, setAccounts] = useState<Account[]>([])
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastDesc, setLastDesc] = useState<string | null>(null)

  // Active categories for this group, in their configured order. Categories are
  // created/mapped on the web app; mobile only picks among them.
  const activeCategories = group.categories
    .filter((c) => !c.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  useEffect(() => {
    async function loadDefaults() {
      const [savedCurrency, savedDesc, savedCategory] = await Promise.all([
        AsyncStorage.getItem(LAST_CURRENCY_KEY(group.id)),
        AsyncStorage.getItem(LAST_DESC_KEY(group.id)),
        AsyncStorage.getItem(LAST_CATEGORY_KEY(group.id)),
      ])
      if (savedCurrency) setCurrency(savedCurrency)
      if (savedDesc) setLastDesc(savedDesc)
      // Restore the sticky category only if it is still an active category.
      if (savedCategory && group.categories.some((c) => c.id === savedCategory && !c.archivedAt)) {
        setCategoryId(savedCategory)
      }
    }
    loadDefaults()
  }, [group.id])

  // Load the caller's accounts for the payment-account picker, identify which
  // member is the caller (by email), and pre-select the caller as payer + their
  // default payment account. Account ownership is per-user, so the picker lists
  // the caller's own accounts — mirroring the web form, which likewise posts the
  // payer chip plus the caller's payment account.
  useEffect(() => {
    let cancelled = false
    async function loadAccounts() {
      try {
        const [accs, email] = await Promise.all([fetchAccounts(), getEmail()])
        if (cancelled) return
        const active = accs.filter((a) => !a.deletedAt)
        setAccounts(active)
        const me = group.members.find((m) => m.userEmail === email)
        if (me) {
          setMyUserId(me.userId)
          setPaidByUserId(me.userId)
        }
        const defaultId = me?.defaultPaymentAccountId
        if (defaultId && active.some((a) => a.id === defaultId)) {
          setPaymentAccountId(defaultId)
        }
      } catch {
        // Non-fatal: the picker just starts empty; submit is guarded below.
      }
    }
    loadAccounts()
    return () => {
      cancelled = true
    }
  }, [group.id])

  // Where the caller's own share will post, mirroring the backend resolution:
  // selected category's mapping → the caller's group default expense account →
  // uncategorized. Helps the user see what picking a category actually does.
  const selectedCategory = activeCategories.find((c) => c.id === categoryId) ?? null
  const myMember = group.members.find((m) => m.userId === myUserId) ?? null
  const accountPath = (id: string | null | undefined) =>
    id ? (accounts.find((a) => a.id === id)?.path ?? null) : null
  const postingAccountPath =
    accountPath(selectedCategory?.myMapping?.accountId) ??
    accountPath(myMember?.defaultExpenseAccountId) ??
    'uncategorized'

  function selectCategory(id: string) {
    // Tap the selected chip again to clear the category (uncategorized).
    setCategoryId((current) => (current === id ? null : id))
  }

  async function handleSubmit() {
    if (!amount.trim() || isNaN(parseFloat(amount))) {
      setError('Enter a valid amount')
      return
    }
    // The backend requires the payment account the payer fronted the money from.
    if (!paymentAccountId) {
      setError('Choose a payment account')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await createExpense(group.id, {
        description: description.trim() || 'Expense',
        amount: parseFloat(amount).toFixed(2),
        currency,
        date,
        paidByUserId,
        paymentAccountId,
        categoryId,
      })
      // Persist for next time. The category is kept sticky per group (or the
      // sticky entry cleared when this expense was left uncategorized).
      await Promise.all([
        AsyncStorage.setItem(LAST_CURRENCY_KEY(group.id), currency),
        AsyncStorage.setItem(LAST_DESC_KEY(group.id), description.trim() || 'Expense'),
        categoryId
          ? AsyncStorage.setItem(LAST_CATEGORY_KEY(group.id), categoryId)
          : AsyncStorage.removeItem(LAST_CATEGORY_KEY(group.id)),
      ])
      setLastDesc(description.trim() || 'Expense')
      setAmount('')
      setDescription('')
      setDate(today)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      onExpenseAdded()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      {/* Amount — large and prominent */}
      <View style={styles.amountRow}>
        <Text style={styles.currencyPrefix}>{currency}</Text>
        <TextInput
          style={styles.amountInput}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={theme.color.textDisabled}
        />
      </View>

      {/* Currency quick-select — TODO: expand to a full bottom-sheet picker */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.currencyRow}
        contentContainerStyle={styles.chipStrip}
      >
        {['CAD', 'USD', 'EUR', 'GBP', 'JPY'].map((c) => (
          <Chip key={c} label={c} active={currency === c} onPress={() => setCurrency(c)} />
        ))}
      </ScrollView>

      {/* Description */}
      <Text style={styles.label}>Description</Text>
      <TextInput
        style={styles.input}
        value={description}
        onChangeText={setDescription}
        placeholder="Expense"
      />
      {lastDesc && lastDesc !== description && (
        <TouchableOpacity
          style={styles.againChip}
          onPress={() => setDescription(lastDesc)}
        >
          <Text style={styles.againChipText}>↩ Again: {lastDesc}</Text>
        </TouchableOpacity>
      )}

      {/* Date — plain text for now, DateTimePicker TODO */}
      <Text style={styles.label}>Date</Text>
      <TextInput
        style={styles.input}
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        keyboardType="numeric"
      />

      {/* Category — chips of the group's active categories (managed on web).
          Tap the selected chip to clear. Drives where each member's share posts. */}
      {activeCategories.length > 0 && (
        <>
          <Text style={styles.label}>Category</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryRow}
            contentContainerStyle={styles.chipStrip}
          >
            {activeCategories.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                active={categoryId === c.id}
                onPress={() => selectCategory(c.id)}
              />
            ))}
          </ScrollView>
          <Text style={styles.postingHint} numberOfLines={1}>
            Your share posts to {postingAccountPath}
          </Text>
        </>
      )}

      {/* Payment account — the account the payer fronted the money from */}
      <AccountPicker
        label="Paid from"
        accounts={accounts}
        selectedId={paymentAccountId}
        onSelect={setPaymentAccountId}
        placeholder="Select payment account"
      />

      {/* Paid by */}
      <Text style={styles.label}>Paid by</Text>
      <View style={styles.memberRow}>
        {group.members.map((m: GroupMember) => (
          <Chip
            key={m.userId}
            label={m.userName}
            active={paidByUserId === m.userId}
            onPress={() => setPaidByUserId(m.userId)}
          />
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        title="Add expense"
        onPress={handleSubmit}
        loading={loading}
        style={styles.submitButton}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  amountRow: {
    ...cardStyle,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.sp.md,
    marginBottom: theme.sp.xs,
  },
  currencyPrefix: {
    fontSize: theme.text.lg,
    color: theme.color.textMuted,
    marginRight: theme.sp.xs,
  },
  amountInput: {
    flex: 1,
    fontSize: 36,
    fontWeight: '300',
    paddingVertical: theme.sp.md,
    color: theme.color.text,
  },
  currencyRow: { marginBottom: theme.sp.md },
  chipStrip: { gap: theme.sp.xs },
  label: {
    fontSize: theme.text.sm,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
    marginBottom: 4,
    marginTop: theme.sp.xs,
  },
  categoryRow: { marginBottom: 4 },
  postingHint: {
    fontSize: theme.text.xs,
    color: theme.color.textMuted,
    marginTop: 2,
    marginBottom: 4,
  },
  input: {
    backgroundColor: theme.color.windowInset,
    borderWidth: 1,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.lg,
    padding: theme.sp.sm,
    fontSize: theme.text.base,
  },
  againChip: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: theme.sp.xs,
    paddingVertical: 4,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.accentChipBg,
    borderWidth: 1,
    borderColor: theme.color.accentHi,
  },
  againChipText: { fontSize: theme.text.xs, color: theme.color.accentChipFg },
  memberRow: { flexDirection: 'row', gap: theme.sp.xs, flexWrap: 'wrap' },
  error: { color: theme.color.danger, fontSize: theme.text.sm, marginTop: theme.sp.xs },
  submitButton: { marginTop: theme.sp.md },
})
