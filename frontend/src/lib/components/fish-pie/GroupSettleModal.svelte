<script lang="ts">
  import { untrack } from "svelte"
  import Modal from "$lib/components/ui/Modal.svelte"
  import GradientButton from "$lib/components/ui/GradientButton.svelte"
  import TextInput from "$lib/components/ui/TextInput.svelte"
  import CurrencyInput from "$lib/components/ui/CurrencyInput.svelte"
  import Icon from "$lib/components/ui/Icon.svelte"
  import AccountPathInput from "$lib/components/accounts/AccountPathInput.svelte"
  import type { Account } from "$lib/api"
  import { initials } from "./utils"

  interface SettlePayload {
    fromUserId: string
    toUserId: string
    amount: string
    currency: string
    date: string
    note: string | undefined
    payerAccountId: string
  }

  interface Props {
    open: boolean
    fromUserId: string
    toUserId: string
    fromName: string
    toName: string
    initialAmount: string
    currency: string
    payerAccounts: Account[]
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
    payerAccounts,
    onSettle,
  }: Props = $props()

  let amount = $state("")
  let selectedCurrency = $state(untrack(() => currency))
  let date = $state(new Date().toISOString().slice(0, 10))
  let note = $state("")
  let payerAccountId = $state("")
  let error = $state("")
  let submitting = $state(false)

  let dateInputEl = $state<HTMLInputElement | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const dateLabel = $derived(
    date === today
      ? "Today"
      : new Date(date + "T00:00:00").toLocaleDateString("en-CA", {
          month: "short",
          day: "numeric",
        })
  )

  function openDatePicker() {
    ;(dateInputEl as any)?.showPicker?.()
    dateInputEl?.focus()
  }

  $effect(() => {
    if (open) {
      amount = initialAmount
      selectedCurrency = currency
      date = new Date().toISOString().slice(0, 10)
      note = ""
      payerAccountId = ""
      error = ""
    }
  })

  async function handleSettle() {
    if (!fromUserId || !toUserId || fromUserId === toUserId || !amount || !payerAccountId || submitting)
      return
    error = ""
    submitting = true
    try {
      await onSettle({
        fromUserId,
        toUserId,
        amount,
        currency: selectedCurrency,
        date,
        note: note.trim() || undefined,
        payerAccountId,
      })
      open = false
    } catch (e: any) {
      error = e.message ?? "Failed to propose settlement"
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
    <div class="transfer-card">
      <div class="transfer-actor">
        <div class="transfer-avatar">{initials(fromName)}</div>
        <span class="transfer-name">{fromName}</span>
        <span class="transfer-role">pays</span>
      </div>
      <div class="transfer-arrow">
        <Icon name="arrow-right" size={16} />
      </div>
      <div class="transfer-actor">
        <div class="transfer-avatar to">{initials(toName)}</div>
        <span class="transfer-name">{toName}</span>
        <span class="transfer-role">receives</span>
      </div>
    </div>

    <div class="amount-row">
      <div class="amount-field">
        <TextInput
          bind:value={amount}
          placeholder="0.00"
          type="number"
          min="0"
          step="0.01"
          class="amount-input"
        />
      </div>
      <div class="currency-field">
        <CurrencyInput bind:value={selectedCurrency} style="width: 44px" />
      </div>
    </div>

    <div class="meta-row">
      <div class="date-chip-wrap">
        <button class="date-chip" onclick={openDatePicker}>
          <span class="date-chip-icon"><Icon name="calendar" size={12} /></span>
          <span class="date-chip-label">{dateLabel}</span>
          <Icon name="chevron-down-line" size={10} />
        </button>
        <input
          bind:this={dateInputEl}
          type="date"
          class="date-input-hidden"
          bind:value={date}
        />
      </div>
      <div class="note-wrap">
        <TextInput bind:value={note} placeholder="Note (optional)" class="note-input" />
      </div>
    </div>

    <div class="field">
      <span class="field-label">Paid from</span>
      <AccountPathInput
        accounts={payerAccounts}
        bind:value={payerAccountId}
        placeholder="Account paid from…"
        allowCreate={false}
      />
    </div>

    {#if error}
      <span class="form-error">{error}</span>
    {/if}

    <div class="settle-actions">
      <GradientButton
        onclick={() => {
          open = false
          error = ""
        }}
      >
        Cancel
      </GradientButton>
      <GradientButton onclick={handleSettle} disabled={submitting || !amount || !payerAccountId}>
        {submitting ? "Proposing…" : "Propose"}
      </GradientButton>
    </div>
  </div>
</Modal>

<style>
  .settle-modal {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    min-width: 320px;
  }

  /* Transfer direction */
  .transfer-card {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-md);
    padding: var(--sp-sm) var(--sp-md);
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule-soft);
    margin: calc(-1 * var(--sp-md));
    margin-bottom: 0;
  }

  .transfer-actor {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: 80px;
  }

  .transfer-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--color-accent-light);
    border: 1px solid var(--color-accent);
    color: var(--color-accent-chip-fg);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .transfer-avatar.to {
    background: var(--color-window-raised);
    border-color: var(--color-border);
    color: var(--color-text-muted);
  }

  .transfer-name {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }

  .transfer-role {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .transfer-arrow {
    color: var(--color-text-muted);
    flex-shrink: 0;
    margin-bottom: 16px;
  }

  /* Amount */
  .amount-row {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding-top: var(--sp-xs);
  }

  .amount-field {
    flex: 1;
    min-width: 0;
  }

  .settle-modal :global(.amount-input) {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    height: 56px;
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-xl);
    width: 100%;
    box-sizing: border-box;
  }

  .currency-field {
    flex-shrink: 0;
    align-self: flex-end;
    padding-bottom: 2px;
  }

  /* Date + note row */
  .meta-row {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .date-chip-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .date-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    background: linear-gradient(
      180deg,
      var(--color-btn-gradient-hi),
      var(--color-rule-soft)
    );
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-xl);
    cursor: pointer;
    color: var(--color-text);
    white-space: nowrap;
    transition: border-color var(--duration-fast) var(--ease);
  }

  .date-chip:hover {
    border-color: var(--color-accent);
  }

  .date-chip-icon {
    line-height: 1;
  }

  .date-chip-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .date-input-hidden {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    width: 0;
    height: 0;
    top: 0;
    left: 0;
  }

  .note-wrap {
    flex: 1;
    min-width: 0;
  }

  .settle-modal :global(.note-input) {
    width: 100%;
    box-sizing: border-box;
  }

  /* Actions */
  .settle-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-xs);
    padding-top: var(--sp-xs);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .form-error {
    font-size: var(--text-xs);
    color: var(--color-amount-negative);
    font-family: var(--font-sans);
    display: block;
  }
</style>
