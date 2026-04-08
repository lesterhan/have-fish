<script lang="ts">
  import Modal from '../ui/Modal.svelte'
  import Button from '../ui/Button.svelte'
  import { fetchAccountBalanceAtDate, createTransaction } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import { toISODate } from '$lib/date'

  interface Props {
    accountId: string
    accountPath: string
    open: boolean
    onSuccess?: () => void
  }

  let {
    accountId,
    accountPath,
    open = $bindable(),
    onSuccess,
  }: Props = $props()

  function todayIso(): string {
    return toISODate(new Date())
  }

  // --- Form state ---
  let statementDate = $state(todayIso())
  let statementAmount = $state('')
  let currency = $state('CAD')

  // --- Result state ---
  type CheckResult = {
    ledgerAmount: string
    statementAmount: string
    currency: string
    difference: string // statement - ledger (positive = ledger is short, negative = ledger is over)
  }
  let result = $state<CheckResult | null>(null)
  let checking = $state(false)
  let checkError = $state('')

  // --- Submit state ---
  let submitting = $state(false)
  let submitError = $state('')
  let posted = $state(false)

  // Ensure settings are loaded when the modal opens so adjustmentsAccountId is available.
  $effect(() => {
    if (open) settingsStore.load()
  })

  let formValid = $derived(
    statementDate.length > 0 &&
      statementAmount.trim().length > 0 &&
      !isNaN(parseFloat(statementAmount)) &&
      currency.trim().length > 0,
  )

  async function handleCheck() {
    checking = true
    checkError = ''
    result = null
    try {
      const balance = await fetchAccountBalanceAtDate(accountId, statementDate)
      const ledger = balance.balances.find(
        (b) => b.currency === currency.trim().toUpperCase(),
      )
      const ledgerAmount = ledger?.amount ?? '0.00'
      const stmt = parseFloat(statementAmount)
      const ledger_ = parseFloat(ledgerAmount)
      const diff = (stmt - ledger_).toFixed(2)
      result = {
        ledgerAmount,
        statementAmount: stmt.toFixed(2),
        currency: currency.trim().toUpperCase(),
        difference: diff,
      }
    } catch (e) {
      checkError = e instanceof Error ? e.message : 'Failed to fetch balance.'
    } finally {
      checking = false
    }
  }

  async function handlePostAdjustment() {
    if (!result) return
    const adjustmentsAccountId =
      settingsStore.value?.defaultAdjustmentsAccountId
    if (!adjustmentsAccountId) {
      submitError = 'No adjustments account set. Configure one in Settings.'
      return
    }
    const diff = parseFloat(result.difference)
    if (diff === 0) return

    submitting = true
    submitError = ''
    try {
      await createTransaction({
        date: statementDate,
        description: `Reconciliation adjustment — ${accountPath}`,
        postings: [
          { accountId, amount: result.difference, currency: result.currency },
          {
            accountId: adjustmentsAccountId,
            amount: (-diff).toFixed(2),
            currency: result.currency,
          },
        ],
      })
      posted = true
      onSuccess?.()
    } catch (e) {
      submitError =
        e instanceof Error ? e.message : 'Failed to post adjustment.'
    } finally {
      submitting = false
    }
  }

  function close() {
    open = false
    setTimeout(() => {
      statementDate = todayIso()
      statementAmount = ''
      currency = 'CAD'
      result = null
      checkError = ''
      submitError = ''
      posted = false
    }, 200)
  }

  let isBalanced = $derived(
    result !== null && parseFloat(result.difference) === 0,
  )
</script>

<Modal title="Reconcile — {accountPath}" bind:open onclose={close}>
  <div class="reconcile-body">
    <div class="form-grid">
      <label for="rec-date">Statement date</label>
      <input
        id="rec-date"
        type="date"
        bind:value={statementDate}
        onchange={() => {
          result = null
          posted = false
        }}
      />

      <label for="rec-amount">Statement balance</label>
      <div class="balance-row">
        <input
          id="rec-amount"
          type="text"
          inputmode="decimal"
          bind:value={statementAmount}
          placeholder="0.00"
          class="balance-amount"
          oninput={() => {
            result = null
            posted = false
          }}
        />
        <input
          type="text"
          bind:value={currency}
          placeholder="CAD"
          class="balance-currency"
          maxlength={5}
          spellcheck={false}
          onchange={() => {
            result = null
            posted = false
          }}
        />
      </div>
    </div>

    {#if checkError}
      <p class="error">{checkError}</p>
    {/if}

    {#if result}
      <div class="comparison">
        <div class="comparison-row">
          <span class="comp-label">Ledger balance</span>
          <span class="comp-value mono"
            >{result.ledgerAmount} {result.currency}</span
          >
        </div>
        <div class="comparison-row">
          <span class="comp-label">Statement balance</span>
          <span class="comp-value mono"
            >{result.statementAmount} {result.currency}</span
          >
        </div>
        <div class="comparison-divider"></div>
        <div class="comparison-row">
          <span class="comp-label">Difference</span>
          <span
            class="comp-value mono"
            class:positive={parseFloat(result.difference) > 0}
            class:negative={parseFloat(result.difference) < 0}
          >
            {result.difference}
            {result.currency}
          </span>
        </div>

        {#if isBalanced}
          <p class="balanced">Ledger is balanced.</p>
        {:else if posted}
          <p class="balanced">Adjustment posted.</p>
        {:else}
          {#if !settingsStore.value?.defaultAdjustmentsAccountId}
            <p class="warn">
              No adjustments account configured — set one in Settings before
              posting.
            </p>
          {/if}
          {#if submitError}
            <p class="error">{submitError}</p>
          {/if}
        {/if}
      </div>
    {/if}
  </div>

  <div class="footer">
    {#if !result || (!isBalanced && !posted)}
      <Button
        variant="primary"
        onclick={handleCheck}
        disabled={!formValid || checking}
      >
        {checking ? 'Checking…' : 'Check balance'}
      </Button>
    {/if}
    {#if result && !isBalanced && !posted}
      <Button
        variant="primary"
        onclick={handlePostAdjustment}
        disabled={submitting ||
          !settingsStore.value?.defaultAdjustmentsAccountId}
      >
        {submitting ? 'Posting…' : 'Post adjustment'}
      </Button>
    {/if}
    {#if isBalanced || posted}
      <Button onclick={close}>Close</Button>
    {/if}
  </div>
</Modal>

<style>
  .reconcile-body {
    min-width: 380px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
  }

  .form-grid {
    display: grid;
    grid-template-columns: 10rem 1fr;
    gap: var(--sp-xs) var(--sp-sm);
    align-items: center;
  }

  .form-grid label {
    font-size: var(--text-sm);
    text-align: right;
  }

  .form-grid input {
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-inset);
    box-shadow: var(--shadow-sunken);
    border: none;
    color: var(--color-text);
    width: 100%;
    box-sizing: border-box;
  }

  .form-grid input:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .balance-row {
    display: flex;
    gap: var(--sp-xs);
  }

  .balance-row input {
    width: auto;
  }

  .balance-amount {
    flex: 1;
    min-width: 0;
  }

  .balance-currency {
    width: 3.5rem;
    flex-shrink: 0;
    text-transform: uppercase;
  }

  .comparison {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
    background: var(--color-window-inset);
    box-shadow: var(--shadow-sunken);
    padding: var(--sp-sm);
  }

  .comparison-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: var(--text-sm);
  }

  .comp-label {
    color: var(--color-text-muted);
  }

  .comp-value {
    color: var(--color-text);
  }

  .comp-value.mono {
    font-family: var(--font-mono);
  }

  .comp-value.positive {
    color: var(--color-amount-positive);
  }

  .comp-value.negative {
    color: var(--color-amount-negative);
  }

  .comparison-divider {
    border-top: 1px solid var(--color-bevel-mid);
    margin: var(--sp-xs) 0;
  }

  .balanced {
    font-size: var(--text-sm);
    color: var(--color-amount-positive);
    margin-top: var(--sp-xs);
  }

  .warn {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    font-style: italic;
    margin-top: var(--sp-xs);
  }

  .error {
    font-size: var(--text-sm);
    color: var(--color-amount-negative);
    background: var(--color-danger-light);
    padding: var(--sp-xs) var(--sp-sm);
    box-shadow: var(--shadow-sunken);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-xs);
    padding-top: var(--sp-md);
    border-top: 1px solid var(--color-bevel-mid);
    margin-top: var(--sp-md);
  }
</style>
