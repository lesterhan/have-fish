<script lang="ts">
  import Modal from "$lib/components/ui/Modal.svelte"
  import GradientButton from "$lib/components/ui/GradientButton.svelte"
  import TextInput from "$lib/components/ui/TextInput.svelte"

  interface SettlePayload {
    fromUserId: string
    toUserId: string
    amount: string
    currency: string
    date: string
    note: string | undefined
  }

  interface Props {
    open: boolean
    fromUserId: string
    toUserId: string
    fromName: string
    toName: string
    initialAmount: string
    currency: string
    onSettle: (data: SettlePayload) => Promise<void>
  }

  let {
    open = $bindable(false),
    fromUserId,
    toUserId,
    fromName,
    toName,
    initialAmount,
    currency,
    onSettle,
  }: Props = $props()

  let amount = $state("")
  let date = $state(new Date().toISOString().slice(0, 10))
  let note = $state("")
  let error = $state("")
  let submitting = $state(false)

  $effect(() => {
    if (open) {
      amount = initialAmount
      date = new Date().toISOString().slice(0, 10)
      note = ""
      error = ""
    }
  })

  async function handleSettle() {
    if (!fromUserId || !toUserId || fromUserId === toUserId || !amount || submitting)
      return
    error = ""
    submitting = true
    try {
      await onSettle({
        fromUserId,
        toUserId,
        amount,
        currency,
        date,
        note: note.trim() || undefined,
      })
      open = false
    } catch (e: any) {
      error = e.message ?? "Failed to record settlement"
    } finally {
      submitting = false
    }
  }
</script>

<Modal
  title="Settle up"
  bind:open
  onclose={() => {
    error = ""
  }}
>
  <div class="settle-modal">
    <div class="settle-modal-summary">
      <span class="settle-modal-name">{fromName}</span>
      <span class="settle-modal-arrow">→</span>
      <span class="settle-modal-name">{toName}</span>
    </div>
    <div class="settle-modal-amount-row">
      <TextInput
        bind:value={amount}
        placeholder="0.00"
        type="number"
        min="0"
        step="0.01"
        class="settle-modal-amount"
      />
      <span class="settle-modal-currency">{currency}</span>
    </div>
    <TextInput bind:value={date} type="date" class="settle-modal-date" />
    <TextInput
      bind:value={note}
      placeholder="Note (optional)"
      class="settle-modal-note"
    />
    {#if error}
      <span class="form-error">{error}</span>
    {/if}
    <div class="settle-modal-actions">
      <GradientButton
        onclick={() => {
          open = false
          error = ""
        }}
      >
        Cancel
      </GradientButton>
      <GradientButton onclick={handleSettle} disabled={submitting || !amount}>
        Record
      </GradientButton>
    </div>
  </div>
</Modal>

<style>
  .settle-modal {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    min-width: 280px;
  }

  .settle-modal-summary {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window);
    box-shadow: var(--shadow-sunken);
    font-size: var(--text-sm);
  }

  .settle-modal-name {
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .settle-modal-arrow {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .settle-modal-amount-row {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .settle-modal :global(.settle-modal-amount) {
    flex: 1;
  }

  .settle-modal-currency {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--color-text-muted);
    min-width: 32px;
  }

  .settle-modal :global(.settle-modal-date),
  .settle-modal :global(.settle-modal-note) {
    width: 100%;
    box-sizing: border-box;
  }

  .settle-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-xs);
    padding-top: var(--sp-xs);
  }

  .form-error {
    font-size: var(--text-xs);
    color: var(--color-amount-negative);
    font-family: var(--font-sans);
    display: block;
  }
</style>
