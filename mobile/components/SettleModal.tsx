import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
import { createSettlement, type CurrencyBalance, type GroupMember } from '@/lib/api'

interface Props {
  transfer: CurrencyBalance['transfers'][number]
  groupId: string
  members: GroupMember[]
  defaultCurrency: string
  onSettled: () => void
  onClose: () => void
}

/**
 * Bottom-sheet-style modal for recording a settlement payment.
 *
 * Pre-filled from the suggested transfer but all fields are editable
 * so the user can record partial payments.
 *
 * TODO:
 * - Replace with a proper bottom sheet (e.g. @gorhom/bottom-sheet) for native feel
 * - Add a date picker
 */
export function SettleModal({ transfer, groupId, members: _members, defaultCurrency, onSettled, onClose }: Props) {
  const [amount, setAmount] = useState(transfer.amount)
  const [currency, setCurrency] = useState(transfer.currency || defaultCurrency)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRecord() {
    if (!amount.trim() || isNaN(parseFloat(amount))) {
      setError('Enter a valid amount')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await createSettlement(groupId, {
        fromUserId: transfer.fromUserId,
        toUserId: transfer.toUserId,
        amount: parseFloat(amount).toFixed(2),
        currency,
        date,
        note: note.trim() || undefined,
      })
      onSettled()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.title}>Record settlement</Text>

          <View style={styles.transferDisplay}>
            <Text style={styles.fromName}>{transfer.fromUserName ?? transfer.fromUserId}</Text>
            <Text style={styles.arrow}>→</Text>
            <Text style={styles.toName}>{transfer.toUserName ?? transfer.toUserId}</Text>
          </View>

          <Text style={styles.label}>Amount</Text>
          <View style={styles.amountRow}>
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
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </View>

          <Text style={styles.label}>Date</Text>
          <TextInput
            style={styles.input}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            keyboardType="numeric"
          />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Venmo transfer"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.recordButton} onPress={handleRecord} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.recordText}>Record</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 36,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  transferDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
    padding: 12,
    backgroundColor: '#f8faff',
    borderRadius: 8,
  },
  fromName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  arrow: { fontSize: 18, color: '#888' },
  toName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  label: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 4, marginTop: 12 },
  amountRow: { gap: 8 },
  currencyRow: { marginBottom: 4 },
  currencyChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ccc',
    marginRight: 8,
    backgroundColor: '#fff',
  },
  currencyChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  currencyChipText: { fontSize: 12, color: '#444' },
  currencyChipTextActive: { color: '#fff', fontWeight: '600' },
  amountInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 6,
    padding: 10,
    fontSize: 24,
    fontWeight: '300',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 6,
    padding: 10,
    fontSize: 15,
  },
  error: { color: '#e74c3c', fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelButton: {
    flex: 1,
    padding: 14,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  cancelText: { fontSize: 15, color: '#444', fontWeight: '600' },
  recordButton: {
    flex: 2,
    padding: 14,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  recordText: { fontSize: 15, color: '#fff', fontWeight: '600' },
})
