<script lang="ts">
  import { untrack } from 'svelte'
  import Modal from '$lib/components/ui/Modal.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import CurrencyInput from '$lib/components/ui/CurrencyInput.svelte'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import Checkbox from '$lib/components/ui/Checkbox.svelte'
  import Card from '$lib/components/ui/Card.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import type { Account, BatchSettlementLine } from '$lib/api'
  import { fetchFxRateAsOf } from '$lib/api'
  import {
    initLines,
    isConverted,
    convertedAmount,
    linesReady,
    buildBatchLines,
    type OwedDebt,
    type SettleLine,
  } from '$lib/fish-pie-settle'

  interface BatchPayload {
    payerAccountId: string
    date: string
    note: string | undefined
    lines: BatchSettlementLine[]
  }

  interface Props {
    open: boolean
    debts: OwedDebt[]
    defaultTargetCurrency: string
    payerAccounts: Account[]
    onSettle: (data: BatchPayload) => Promise<void>
  }

  let { open = $bindable(false), debts, defaultTargetCurrency, payerAccounts, onSettle }: Props = $props()

  const today = () => new Date().toISOString().slice(0, 10)

  // Seeded from defaultTargetCurrency each time the modal opens (see the effect below).
  let target = $state('')
  let lines = $state<SettleLine[]>([])
  let date = $state(today())
  let note = $state('')
  let payerAccountId = $state('')
  let error = $state('')
  let submitting = $state(false)

  // Seed + reset whenever the modal opens.
  $effect(() => {
    if (!open) return
    untrack(() => {
      target = defaultTargetCurrency
      lines = initLines(debts, defaultTargetCurrency)
      date = today()
      note = ''
      payerAccountId = ''
      error = ''
      void refreshRates()
    })
  })

  // Fetch the FX rate for every converted line lacking one and prefill its cash amount
  // (unless the user has already typed an override).
  async function refreshRates() {
    await Promise.all(
      lines.map(async (l, i) => {
        if (!isConverted(l, target) || lines[i].fxRate) return
        const r = await fetchFxRateAsOf(l.debtCurrency, target)
        lines[i].fxRate = r?.rate ?? null
        lines[i].asOfDate = r?.asOfDate ?? null
        if (!lines[i].settledAmount) lines[i].settledAmount = convertedAmount(l.debtAmount, r?.rate ?? null)
      }),
    )
  }

  function clearRate(i: number) {
    lines[i].fxRate = null
    lines[i].asOfDate = null
    lines[i].settledAmount = ''
  }

  function onTargetCommit(code: string) {
    target = code
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].debtCurrency === target) lines[i].convert = false
      clearRate(i)
    }
    void refreshRates()
  }

  function toggleConvert(i: number) {
    if (lines[i].debtCurrency === target) return // can't convert to the same currency
    lines[i].convert = !lines[i].convert
    clearRate(i)
    void refreshRates()
  }

  const ready = $derived(linesReady(lines, target) && !!payerAccountId)

  async function handleSubmit() {
    if (!ready || submitting) return
    error = ''
    submitting = true
    try {
      await onSettle({ payerAccountId, date, note: note.trim() || undefined, lines: buildBatchLines(lines, target) })
      open = false
    } catch (e: any) {
      error = e.message ?? 'Failed to settle'
    } finally {
      submitting = false
    }
  }
</script>

<Modal title="Settle up" bind:open onclose={() => (error = '')}>
  <div class="settle-batch">
    <div class="target-row">
      <span class="field-label">Settle in</span>
      <CurrencyInput value={target} oncommit={onTargetCommit} style="width: 60px" />
      <span class="target-hint">converted debts are paid in this currency</span>
    </div>

    <div class="debts-group">
      <span class="group-label">Balances to settle</span>
      <div class="lines">
      {#each lines as l, i (l.toUserId + l.debtCurrency)}
        {@const converted = isConverted(l, target)}
        <Card gloss muted={!l.include}>
          <div class="line-row">
          <Checkbox
            bind:checked={l.include}
            ariaLabel={l.include ? 'Exclude this debt' : 'Include this debt'}
          />

          <div class="line-main">
            <div class="line-debt">
              <span class="line-to">{l.toUserName ?? 'them'}</span>
              <span class="line-owe">
                owes <CurrencyPill code={l.debtCurrency} /> {parseFloat(l.debtAmount).toFixed(2)}
              </span>
            </div>

            {#if l.debtCurrency !== target}
              <div class="line-mode">
                <button
                  type="button"
                  class="mode-btn"
                  class:mode-btn--on={!l.convert}
                  onclick={() => l.convert && toggleConvert(i)}
                  disabled={!l.include}
                >
                  Pay {l.debtCurrency}
                </button>
                <button
                  type="button"
                  class="mode-btn"
                  class:mode-btn--on={l.convert}
                  onclick={() => !l.convert && toggleConvert(i)}
                  disabled={!l.include}
                >
                  Pay {target}
                </button>
              </div>
            {/if}

            {#if converted}
              <div class="convert-row">
                <TextInput
                  bind:value={l.settledAmount}
                  placeholder="0.00"
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={!l.include}
                  class="convert-amount"
                />
                <CurrencyPill code={target} />
              </div>
              <span class="rate-hint">
                {#if l.fxRate}
                  {l.debtCurrency} → {target} rate {parseFloat(l.fxRate).toFixed(4)} as of {l.asOfDate}
                {:else}
                  no rate found — enter the amount you paid
                {/if}
              </span>
            {/if}
          </div>
          </div>
        </Card>
      {/each}
      </div>
    </div>

    <div class="payment-group">
      <span class="group-label">Payment</span>
      <div class="meta-row">
        <div class="date-field">
          <span class="field-label">Date</span>
          <input type="date" class="date-input" bind:value={date} />
        </div>
        <div class="note-field">
          <span class="field-label">Note</span>
          <TextInput bind:value={note} placeholder="Optional" class="note-input" />
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
    </div>

    {#if error}
      <span class="form-error">{error}</span>
    {/if}

    <div class="actions">
      <GradientButton onclick={() => ((open = false), (error = ''))}>Cancel</GradientButton>
      <GradientButton onclick={handleSubmit} disabled={!ready || submitting}>
        {submitting ? 'Proposing…' : 'Propose'}
      </GradientButton>
    </div>
  </div>
</Modal>

<style>
  .settle-batch {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    min-width: 360px;
  }

  .target-row {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .target-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* Small section label shared by the debts + payment groups. */
  .group-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .debts-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  /* Each debt is its own selectable Aqua gloss Card; this is just the row layout
     inside one. */
  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
  }

  .line-row {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-md);
  }

  /* Strong break between the balances block and the payment form so the bottom
     balance row no longer reads as part of the date/note/paid-from fields. */
  .payment-group {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    margin-top: var(--sp-xs);
    padding-top: var(--sp-md);
    border-top: 2px solid var(--color-rule);
  }

  .line-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .line-debt {
    display: flex;
    align-items: baseline;
    gap: var(--sp-xs);
  }

  .line-to {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .line-owe {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .line-mode {
    display: flex;
    gap: 4px;
  }

  .mode-btn {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    padding: 2px 8px;
    background: linear-gradient(180deg, var(--color-btn-gradient-hi), var(--color-rule-soft));
    border: 1px solid var(--color-rule);
    cursor: pointer;
    color: var(--color-text-muted);
    transition: all var(--duration-fast) var(--ease);
  }

  .mode-btn--on {
    border-color: var(--color-accent);
    color: var(--color-text);
  }

  .mode-btn:disabled {
    cursor: default;
  }

  .convert-row {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .settle-batch :global(.convert-amount) {
    width: 120px;
    font-family: var(--font-mono);
  }

  .rate-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-style: italic;
  }

  .meta-row {
    display: flex;
    gap: var(--sp-sm);
  }

  .date-field,
  .note-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .note-field {
    flex: 1;
  }

  .date-input {
    height: 28px;
    padding: 0 6px;
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-inset);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text);
  }

  .settle-batch :global(.note-input) {
    width: 100%;
    box-sizing: border-box;
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
    display: block;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-xs);
    padding-top: var(--sp-xs);
  }
</style>
