import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  confirmBatchSettlement,
  confirmSettlement,
  type Account,
  type ExpenseGroup,
} from '@/lib/api'
import { receiptLines, type IncomingBatch } from '@/lib/settle-actions'
import * as haptics from '@/lib/haptics'
import { theme } from '@/lib/theme'
import { BottomSheet } from './BottomSheet'
import { AccountPicker } from './AccountPicker'
import { GlossButton } from './GlossButton'
import { Label } from './Label'

interface Props {
  visible: boolean
  group: ExpenseGroup
  /** The pending batch awaiting this user's confirmation, or null. */
  batch: IncomingBatch | null
  /** The receiver's own accounts, for the receive-into picker. */
  accounts: Account[]
  /** Pre-selected receiver account (the user's group default), or '' for none. */
  defaultReceiverAccountId: string
  onClose: () => void
  /** Fired after a successful confirm — the tab refreshes its data. */
  onConfirmed: () => void
}

/**
 * Receiver-side confirmation of a pending settlement batch. Books the combined
 * receiving leg into the chosen account and flips every row in the batch to
 * `completed` (Story 4). A legacy single settlement (null `batchId`) confirms via
 * the single endpoint instead.
 */
export function ConfirmSheet({
  visible,
  group,
  batch,
  accounts,
  defaultReceiverAccountId,
  onClose,
  onConfirmed,
}: Props) {
  const [receiverAccountId, setReceiverAccountId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setReceiverAccountId(defaultReceiverAccountId)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  async function handleConfirm() {
    if (!batch || !receiverAccountId || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      if (batch.batchId) {
        await confirmBatchSettlement(group.id, batch.batchId, receiverAccountId)
      } else {
        await confirmSettlement(group.id, batch.settlementId, receiverAccountId)
      }
      haptics.success()
      onConfirmed()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to confirm')
    } finally {
      setSubmitting(false)
    }
  }

  const receipts = batch ? receiptLines(batch.rows) : []

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Confirm receipt">
      {batch && (
        <>
          <Text style={styles.intro}>
            <Text style={styles.bold}>{batch.fromUserName}</Text> paid you. Confirm to record it
            into your account.
          </Text>

          <Label style={styles.label}>You receive</Label>
          <View style={styles.receipts}>
            {receipts.map((r) => (
              <Text key={r.currency} style={styles.receiptPill}>
                {r.amount} {r.currency}
              </Text>
            ))}
          </View>

          <AccountPicker
            accounts={accounts}
            selectedId={receiverAccountId}
            onSelect={setReceiverAccountId}
            label="Receive into"
            placeholder="Account received into…"
          />

          {error != null && <Text style={styles.error}>{error}</Text>}

          <GlossButton
            label={submitting ? 'Confirming…' : 'Confirm receipt'}
            disabled={!receiverAccountId || submitting}
            onPress={handleConfirm}
            height={46}
            style={styles.submit}
          />
        </>
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  intro: {
    fontFamily: theme.font.sans,
    fontSize: 14.5,
    color: theme.color.ink,
    marginBottom: theme.sp.sm,
  },
  bold: { fontWeight: theme.weight.bold },
  label: { marginBottom: theme.sp.xs },
  receipts: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.sp.xs, marginBottom: theme.sp.sm },
  receiptPill: {
    fontFamily: theme.font.monoBold,
    fontSize: 14,
    color: theme.color.green,
    backgroundColor: theme.color.greenBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  error: {
    fontFamily: theme.font.sans,
    fontSize: 12.5,
    color: theme.color.red,
    textAlign: 'center',
    marginTop: theme.sp.xs,
  },
  submit: { marginTop: theme.sp.md },
})
