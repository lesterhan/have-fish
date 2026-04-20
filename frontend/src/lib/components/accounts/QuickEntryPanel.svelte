<script lang="ts">
  import { untrack } from 'svelte'
  import { updateAccount, createTransactionsBulk, type Account } from '$lib/api'
  import { toISODate } from '$lib/date'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import CurrencyInput from '$lib/components/ui/CurrencyInput.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'

  interface Props {
    account: Account
    accounts: Account[]
    defaultOffsetAccountId: string | null
    preferredCurrency: string
    onaccountcreated: (a: Account) => void
    onaccountupdated: (a: Account) => void
    onsuccess: () => void
    onclose: () => void
  }

  let {
    account,
    accounts,
    defaultOffsetAccountId,
    preferredCurrency,
    onaccountcreated,
    onaccountupdated,
    onsuccess,
    onclose,
  }: Props = $props()

  type Row = {
    date: string
    description: string
    amount: string
    offsetAccountId: string
  }

  function today(): string {
    return toISODate(new Date())
  }

  function makeRow(prevDate?: string): Row {
    return {
      date: prevDate ?? today(),
      description: '',
      amount: '',
      offsetAccountId: defaultOffsetAccountId ?? '',
    }
  }

  let currency = $state(
    untrack(() => account.defaultCurrency ?? preferredCurrency),
  )
  let rows = $state<Row[]>([makeRow()])
  let submitting = $state(false)
  let error = $state<string | null>(null)

  // When panel-level currency changes, persist it to the account
  async function onCurrencyChange(code: string) {
    currency = code
    const updated = await updateAccount(account.id, { defaultCurrency: code })
    onaccountupdated(updated)
  }

  function addRow() {
    const prev = rows[rows.length - 1]
    rows = [...rows, makeRow(prev?.date)]
  }

  function removeRow(i: number) {
    rows = rows.filter((_, idx) => idx !== i)
    if (rows.length === 0) rows = [makeRow()]
  }

  function isValidAmount(v: string): boolean {
    const n = parseFloat(v)
    return !isNaN(n) && v.trim() !== ''
  }

  let rowCount = $derived(rows.filter((r) => isValidAmount(r.amount)).length)
  let canSubmit = $derived(
    rowCount > 0 && rows.every((r) => isValidAmount(r.amount)),
  )

  async function submit() {
    if (!canSubmit || submitting) return
    submitting = true
    error = null
    try {
      const txns = rows.map((r) => {
        const amt = parseFloat(r.amount)
        return {
          date: r.date,
          description: r.description || undefined,
          postings: [
            {
              accountId: account.id,
              amount: (-amt).toFixed(2),
              currency,
            },
            {
              accountId: r.offsetAccountId,
              amount: amt.toFixed(2),
              currency,
            },
          ],
        }
      })
      await createTransactionsBulk(txns)
      onsuccess()
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Failed to save transactions.'
    } finally {
      submitting = false
    }
  }

  // Handle Tab past last field on last row — add new row
  function handleLastFieldTab(e: KeyboardEvent, rowIdx: number) {
    if (e.key === 'Tab' && !e.shiftKey && rowIdx === rows.length - 1) {
      e.preventDefault()
      addRow()
    }
  }

  // Handle Enter on amount or description to add row
  function handleEnterAddRow(e: KeyboardEvent, rowIdx: number) {
    if (e.key === 'Enter' && rowIdx === rows.length - 1) {
      e.preventDefault()
      addRow()
    }
  }
</script>

<div class="panel">
  <div class="panel-header">
    <div class="header-main">
      <span class="header-title">Quick Entry</span>
      <span class="header-account">→ {account.name ?? account.path}</span>
    </div>
    <div class="header-controls">
      <span class="currency-label">Currency</span>
      <CurrencyInput
        bind:value={currency}
        oncommit={onCurrencyChange}
        style="width: 64px"
      />
      <GradientButton square onclick={onclose} tooltip="Close">
        <Icon name="close" size={12} />
      </GradientButton>
    </div>
  </div>

  <div class="rows-wrapper">
    {#each rows as row, i (i)}
      <div class="entry-card" class:alt={i % 2 === 1}>
        <div class="card-top">
          <input
            class="field field-text"
            type="text"
            placeholder="Description"
            bind:value={row.description}
            onkeydown={(e) => handleEnterAddRow(e, i)}
          />
          <input
            class="field field-amount"
            class:income={parseFloat(row.amount) < 0}
            class:expense={parseFloat(row.amount) > 0}
            type="text"
            inputmode="decimal"
            placeholder="0.00"
            bind:value={row.amount}
            onkeydown={(e) => handleEnterAddRow(e, i)}
          />
          <button
            class="remove-btn"
            onclick={() => removeRow(i)}
            aria-label="Remove row">×</button
          >
        </div>
        <div class="card-bottom">
          <input class="field field-date" type="date" bind:value={row.date} />
          <AccountPathInput
            {accounts}
            bind:value={row.offsetAccountId}
            placeholder="expenses:…"
            allowCreate={true}
            oncreate={(a) => {
              onaccountcreated(a)
              accounts = [...accounts, a]
              row.offsetAccountId = a.id
            }}
            oncommit={i === rows.length - 1
              ? (id) => {
                  row.offsetAccountId = id
                }
              : undefined}
          />
        </div>
      </div>
    {/each}
    <button class="add-row-btn" onclick={addRow}>+ Add row</button>
  </div>

  <div class="panel-footer">
    <div class="footer-left"></div>
    <div class="footer-right">
      {#if error}
        <span class="error-msg">{error}</span>
      {/if}
      <GradientButton onclick={submit} disabled={!canSubmit || submitting}>
        {submitting
          ? 'Saving…'
          : `Save ${rowCount} transaction${rowCount === 1 ? '' : 's'}`}
      </GradientButton>
    </div>
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-window);
    border-left: 1px solid var(--color-rule);
    overflow: hidden;
  }

  /* Header */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-sm);
    padding: 8px 14px;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
    flex-shrink: 0;
  }

  .header-main {
    display: flex;
    align-items: baseline;
    gap: var(--sp-sm);
    min-width: 0;
  }

  .header-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .header-account {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    flex-shrink: 0;
  }

  .currency-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  /* Rows */
  .rows-wrapper {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .entry-card {
    padding: 5px 8px;
    border-bottom: 1px solid var(--color-rule);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .entry-card.alt {
    background: var(--color-window-raised);
  }

  .card-top {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .card-top .field-text {
    flex: 1;
    min-width: 0;
  }

  .card-top .field-amount {
    width: 90px;
    flex-shrink: 0;
  }

  .card-bottom {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .card-bottom .field-date {
    width: 120px;
    flex-shrink: 0;
    height: 22px;
    min-height: 22px;
    max-height: 22px;
    line-height: 1;
    -webkit-appearance: none;
    appearance: none;
  }

  .card-bottom :global(.wrapper) {
    flex: 1;
    min-width: 0;
    height: 28px;
  }

  /* Fields */
  .field {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
    padding: 2px var(--sp-xs);
    height: 22px;
    outline: none;
    transition:
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .field:focus {
    border-color: var(--color-accent-mid);
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.08),
      0 0 0 2px var(--color-accent-light);
  }

  .field-amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .field-amount.income {
    color: var(--color-amount-positive);
  }

  .field-amount.expense {
    color: var(--color-amount-negative);
  }

  /* Remove button */
  .remove-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: none;
    border: none;
    color: var(--color-text-muted);
    font-size: 14px;
    cursor: pointer;
    padding: 0;
    transition: color var(--duration-fast) var(--ease);
  }

  .remove-btn:hover {
    color: var(--color-amount-negative);
  }

  /* Inline add-row button */
  .add-row-btn {
    display: block;
    width: 100%;
    padding: 5px 8px;
    text-align: left;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-muted);
    background: none;
    border: none;
    border-bottom: 1px solid var(--color-rule);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease), background var(--duration-fast) var(--ease);
  }

  .add-row-btn:hover {
    color: var(--color-accent);
    background: var(--color-accent-light);
  }

  /* Footer */
  .panel-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-sm);
    padding: 8px 14px;
    border-top: 1px solid var(--color-rule);
    background: var(--color-window);
    flex-shrink: 0;
  }

  .footer-left {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .footer-right {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }


  .error-msg {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-amount-negative);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
