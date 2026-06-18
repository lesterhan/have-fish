import { useState, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createExpense, fetchAccounts, type Account, type ExpenseGroup, type GroupMember } from '@/lib/api'
import { getEmail } from '@/lib/auth'
import { AccountPicker } from './AccountPicker'

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
          placeholderTextColor="#bbb"
        />
      </View>

      {/* Currency quick-select — TODO: expand to a full bottom-sheet picker */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.currencyRow}>
        {['CAD', 'USD', 'EUR', 'GBP', 'JPY'].map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.currencyChip, currency === c && styles.currencyChipActive]}
            onPress={() => setCurrency(c)}
          >
            <Text style={[styles.currencyChipText, currency === c && styles.currencyChipTextActive]}>
              {c}
            </Text>
          </TouchableOpacity>
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryRow}>
            {activeCategories.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.categoryChip, categoryId === c.id && styles.categoryChipActive]}
                onPress={() => selectCategory(c.id)}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    categoryId === c.id && styles.categoryChipTextActive,
                  ]}
                >
                  {c.name}
                </Text>
              </TouchableOpacity>
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
          <TouchableOpacity
            key={m.userId}
            style={[styles.memberChip, paidByUserId === m.userId && styles.memberChipActive]}
            onPress={() => setPaidByUserId(m.userId)}
          >
            <Text
              style={[
                styles.memberChipText,
                paidByUserId === m.userId && styles.memberChipTextActive,
              ]}
            >
              {m.userName}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>Add expense</Text>
        )}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  currencyPrefix: { fontSize: 18, color: '#888', marginRight: 8 },
  amountInput: {
    flex: 1,
    fontSize: 36,
    fontWeight: '300',
    paddingVertical: 16,
    color: '#1a1a1a',
  },
  currencyRow: { marginBottom: 16 },
  currencyChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ccc',
    marginRight: 8,
    backgroundColor: '#fff',
  },
  currencyChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  currencyChipText: { fontSize: 13, color: '#444' },
  currencyChipTextActive: { color: '#fff', fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 4, marginTop: 8 },
  categoryRow: { marginBottom: 4 },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ccc',
    marginRight: 8,
    backgroundColor: '#fff',
  },
  categoryChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  categoryChipText: { fontSize: 13, color: '#444' },
  categoryChipTextActive: { color: '#fff', fontWeight: '600' },
  postingHint: { fontSize: 12, color: '#888', marginTop: 2, marginBottom: 4 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 6,
    padding: 10,
    fontSize: 15,
  },
  againChip: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  againChipText: { fontSize: 12, color: '#2563eb' },
  memberRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  memberChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
  memberChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  memberChipText: { fontSize: 14, color: '#444' },
  memberChipTextActive: { color: '#fff', fontWeight: '600' },
  error: { color: '#c0392b', fontSize: 13, marginTop: 8 },
  submitButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
