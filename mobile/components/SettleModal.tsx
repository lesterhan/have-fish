import { useState } from 'react'
import { View, Text, TextInput, Modal, StyleSheet, ScrollView } from 'react-native'
import { createSettlement, type CurrencyBalance, type GroupMember } from '@/lib/api'
import { Chip } from './Chip'
import { Button } from './Button'
import { theme } from '@/lib/theme'

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
export function SettleModal({ transfer, groupId, members, defaultCurrency, onSettled, onClose }: Props) {
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
    // The backend requires the payer's account the money leaves from. Until a
    // dedicated picker lands (settlement UI is deferred past MVP), use the
    // payer's default payment account set on the web app.
    const payer = members.find((m) => m.userId === transfer.fromUserId)
    const payerAccountId = payer?.defaultPaymentAccountId
    if (!payerAccountId) {
      setError('No default payment account for the payer. Set one in the web app first.')
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
        payerAccountId,
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
            <Button
              title="Cancel"
              variant="neutral"
              onPress={onClose}
              style={styles.cancelButton}
            />
            <Button
              title="Record"
              onPress={handleRecord}
              loading={loading}
              style={styles.recordButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: theme.color.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.color.window,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    padding: theme.sp.lg,
    paddingBottom: theme.sp.xl,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: theme.color.rule,
    borderRadius: theme.radius.lg,
    alignSelf: 'center',
    marginBottom: theme.sp.md,
  },
  title: {
    fontSize: theme.text.lg,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
    marginBottom: theme.sp.md,
  },
  transferDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.sp.sm,
    marginBottom: theme.sp.lg,
    padding: theme.sp.sm,
    backgroundColor: theme.color.accentChipBg,
    borderRadius: theme.radius.lg,
  },
  fromName: {
    fontSize: theme.text.base,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
  },
  arrow: { fontSize: theme.text.lg, color: theme.color.textMuted },
  toName: {
    fontSize: theme.text.base,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
  },
  label: {
    fontSize: theme.text.sm,
    fontWeight: theme.weight.semibold,
    color: theme.color.text,
    marginBottom: 4,
    marginTop: theme.sp.sm,
  },
  amountRow: { gap: theme.sp.xs },
  currencyRow: { marginBottom: 4 },
  chipStrip: { gap: theme.sp.xs },
  amountInput: {
    borderWidth: 1,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.lg,
    padding: theme.sp.sm,
    fontSize: theme.text['2xl'],
    fontWeight: '300',
    backgroundColor: theme.color.windowInset,
    color: theme.color.text,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.lg,
    padding: theme.sp.sm,
    fontSize: theme.text.base,
    backgroundColor: theme.color.windowInset,
    color: theme.color.text,
  },
  error: { color: theme.color.danger, fontSize: theme.text.sm, marginTop: theme.sp.xs },
  actions: { flexDirection: 'row', gap: theme.sp.xs, marginTop: theme.sp.lg },
  cancelButton: { flex: 1 },
  recordButton: { flex: 2 },
})
