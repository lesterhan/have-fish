<script lang="ts">
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import Toggle from '$lib/components/ui/Toggle.svelte'
  import type { Account, ImportPreviewResult } from '$lib/api'

  export type RowState = {
    offsetAccountId: string
    conversionAccountId: string
    feeAccountId: string
    skipped: boolean
  }

  interface Props {
    preview: ImportPreviewResult
    rowStates: RowState[]
    accounts: Account[]
    fromAccountId: string
    importAsLiabilities: boolean
    defaultCurrency: string
    loading: boolean
    error: string
    missingPaths: string[]
    onaccountcreated: (account: Account) => void
    oncreatemissing: (path: string) => void
    oncreateallmissing: () => void
    onconfirm: () => void
    oncancel: () => void
  }

  let {
    preview,
    rowStates = $bindable(),
    accounts,
    fromAccountId = $bindable(),
    importAsLiabilities = $bindable(),
    defaultCurrency,
    loading,
    error,
    missingPaths,
    onaccountcreated,
    oncreatemissing,
    oncreateallmissing,
    onconfirm,
    oncancel,
  }: Props = $props()

  function displayAmount(amount: string): string {
    if (!importAsLiabilities) return amount
    const n = parseFloat(amount)
    return isNaN(n) ? amount : String(-n)
  }

  let confirmDisabled = $derived(
    loading ||
      rowStates.every((r) => r.skipped) ||
      missingPaths.length > 0 ||
      (!preview.isMultiCurrency && !fromAccountId) ||
      rowStates.some((row, i) => {
        if (row.skipped) return false
        const tx = preview.transactions[i]
        if (tx.isTransfer === true)
          return !row.conversionAccountId || !row.feeAccountId
        if (tx.isTransfer === 'same-currency')
          return !row.feeAccountId || !row.offsetAccountId
        return !row.offsetAccountId
      }),
  )
</script>

<div class="preview-window">
  <div class="section-bar">
    <span class="section-bar-title">PREVIEW — {preview.parser}</span>
    <span class="preview-counts">
      {rowStates.filter((r) => !r.skipped).length} ready
      {#if rowStates.filter((r) => r.skipped).length > 0}
        · {rowStates.filter((r) => r.skipped).length} skipped
      {/if}
    </span>
  </div>
  <div class="preview-body">
    {#if !preview.isMultiCurrency}
      <div class="account-row">
        <label class="field-label" for="from-account">
          From account
          {#if !fromAccountId}<span class="required">*</span>{/if}
        </label>
        <AccountPathInput
          {accounts}
          bind:value={fromAccountId}
          placeholder="Select or create an account…"
          oncreate={onaccountcreated}
        />
      </div>
    {/if}

    {#if preview.errors.length > 0}
      <div class="parse-errors">
        <p>
          {preview.errors.length} row(s) could not be parsed and will be skipped.
        </p>
        <ul>
          {#each preview.errors as e}
            <li>Row {e.row}: {e.reason}</li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if missingPaths.length > 0}
      <div class="missing-accounts-banner">
        <span class="missing-label">Accounts needed:</span>
        {#each missingPaths as path}
          <span class="missing-account">
            <code>{path}</code>
            <GradientButton onclick={() => oncreatemissing(path)}>Create</GradientButton>
          </span>
        {/each}
        <GradientButton onclick={oncreateallmissing}>Create all</GradientButton>
      </div>
    {/if}

    <div class="liability-bar">
      <Toggle
        bind:checked={importAsLiabilities}
        label="Import as liabilities"
      />
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th class="col-description">Description</th>
            <th class="col-amount">Amount</th>
            {#if !preview.isMultiCurrency}<th>Currency</th>{/if}
            <th class="col-offset">To account</th>
            <th class="col-skip">Skip</th>
          </tr>
        </thead>
        <tbody>
          {#each preview.transactions as tx, i}
            {#if tx.isTransfer === true}
              <tr class="row-transfer" class:row-skipped={rowStates[i].skipped}>
                <td class="cell-mono">
                  {new Date(tx.date).toLocaleDateString()}
                  {#if tx.possibleDuplicate}
                    <span
                      class="dup-badge"
                      title="Possible duplicate: {tx.possibleDuplicate.date} {tx
                        .possibleDuplicate.amount} {tx.possibleDuplicate
                        .currency}">dup</span
                    >
                  {/if}
                </td>
                <td>{tx.description ?? '—'}</td>
                <td class="cell-transfer-amount">
                  <span class="transfer-from"
                    >{tx.sourceAmount} {tx.sourceCurrency}</span
                  >
                  <span class="transfer-arrow">→</span>
                  <span class="transfer-to"
                    >{tx.targetAmount} {tx.targetCurrency}</span
                  >
                  {#if tx.feeAmount}
                    <span class="transfer-fee"
                      >fee: {tx.feeAmount}
                      {tx.feeCurrency ?? tx.sourceCurrency}</span
                    >
                  {/if}
                </td>
                <td class="cell-offset">
                  <div class="transfer-accounts">
                    <AccountPathInput
                      {accounts}
                      bind:value={rowStates[i].conversionAccountId}
                      placeholder="equity:conversion…"
                      oncreate={onaccountcreated}
                    />
                    <AccountPathInput
                      {accounts}
                      bind:value={rowStates[i].feeAccountId}
                      placeholder="expenses:fees…"
                      oncreate={onaccountcreated}
                    />
                  </div>
                </td>
                <td class="cell-skip"
                  ><input
                    type="checkbox"
                    bind:checked={rowStates[i].skipped}
                  /></td
                >
              </tr>
            {:else if tx.isTransfer === 'same-currency'}
              <tr class="row-transfer" class:row-skipped={rowStates[i].skipped}>
                <td class="cell-mono">
                  {new Date(tx.date).toLocaleDateString()}
                  {#if tx.possibleDuplicate}
                    <span
                      class="dup-badge"
                      title="Possible duplicate: {tx.possibleDuplicate.date} {tx
                        .possibleDuplicate.amount} {tx.possibleDuplicate
                        .currency}">dup</span
                    >
                  {/if}
                </td>
                <td>{tx.description ?? '—'}</td>
                <td class="cell-transfer-amount">
                  <span class="transfer-to">+{tx.amount} {tx.currency}</span>
                  <span class="transfer-fee"
                    >fee: {tx.feeAmount} {tx.currency}</span
                  >
                </td>
                <td class="cell-offset">
                  <div class="transfer-accounts">
                    <AccountPathInput
                      {accounts}
                      bind:value={rowStates[i].offsetAccountId}
                      placeholder="Source account…"
                      oncreate={onaccountcreated}
                    />
                    <AccountPathInput
                      {accounts}
                      bind:value={rowStates[i].feeAccountId}
                      placeholder="expenses:fees…"
                      oncreate={onaccountcreated}
                    />
                  </div>
                </td>
                <td class="cell-skip"
                  ><input
                    type="checkbox"
                    bind:checked={rowStates[i].skipped}
                  /></td
                >
              </tr>
            {:else}
              <tr class:row-skipped={rowStates[i].skipped}>
                <td class="cell-mono">
                  {new Date(tx.date).toLocaleDateString()}
                  {#if tx.possibleDuplicate}
                    <span
                      class="dup-badge"
                      title="Possible duplicate: {tx.possibleDuplicate.date} {tx
                        .possibleDuplicate.amount} {tx.possibleDuplicate
                        .currency}">dup</span
                    >
                  {/if}
                </td>
                <td>{tx.description ?? '—'}</td>
                <td
                  class="cell-amount"
                  class:positive={parseFloat(displayAmount(tx.amount)) > 0}
                  class:negative={parseFloat(displayAmount(tx.amount)) < 0}
                >
                  {displayAmount(
                    tx.amount,
                  )}{#if preview.isMultiCurrency}{tx.currency ??
                      defaultCurrency}{/if}
                </td>
                {#if !preview.isMultiCurrency}<td
                    >{tx.currency ?? defaultCurrency}</td
                  >{/if}
                <td class="cell-offset">
                  <AccountPathInput
                    {accounts}
                    bind:value={rowStates[i].offsetAccountId}
                    placeholder="Select or create…"
                    oncreate={onaccountcreated}
                  />
                </td>
                <td class="cell-skip"
                  ><input
                    type="checkbox"
                    bind:checked={rowStates[i].skipped}
                  /></td
                >
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <div class="panel-actions">
    {#if error}
      <p class="error">{error}</p>
    {/if}
    <div class="action-buttons">
      <GradientButton onclick={oncancel}>Cancel</GradientButton>
      <GradientButton onclick={onconfirm} disabled={confirmDisabled}>
        {loading ? 'Importing…' : 'Confirm import'}
      </GradientButton>
    </div>
  </div>
</div>

<style>
  .preview-window {
    background: var(--color-window);
  }

  .section-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: 4px 12px;
    background: var(--color-section-bar-bg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    color: var(--color-section-bar-fg);
    flex: 1;
    white-space: nowrap;
  }

  .preview-counts {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-section-bar-fg);
    opacity: 0.75;
    white-space: nowrap;
  }

  .preview-body {
    display: flex;
    flex-direction: column;
  }

  .account-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-bevel-mid);
    background: var(--color-window);
    font-size: var(--text-sm);
  }

  .account-row :global(.wrapper) {
    flex: 1;
  }

  .field-label {
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }

  .required {
    color: var(--color-amount-negative);
  }

  .parse-errors {
    font-size: var(--text-sm);
    color: var(--color-danger);
    background: var(--color-danger-light);
    box-shadow: var(--shadow-sunken);
    padding: var(--sp-xs) var(--sp-sm);
    margin-bottom: var(--sp-md);
  }

  .parse-errors p {
    margin: 0 0 var(--sp-xs);
    font-weight: var(--weight-semibold);
  }

  .parse-errors ul {
    margin: 0;
    padding-left: var(--sp-md);
  }

  .missing-accounts-banner {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
    margin-bottom: var(--sp-md);
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
    font-size: var(--text-sm);
  }

  .missing-label {
    font-weight: var(--weight-semibold);
    margin-right: var(--sp-xs);
  }

  .missing-account {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: var(--color-window-raised);
    box-shadow: var(--shadow-sunken);
    padding: 0 var(--sp-xs);
  }

  .missing-account code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .liability-bar {
    display: flex;
    align-items: center;
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-bevel-mid);
    background: var(--color-window);
  }

  .table-container {
    box-shadow: var(--shadow-sunken);
    background: var(--color-window-inset);
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  th {
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
    padding: var(--sp-xs) var(--sp-sm);
    text-align: left;
    font-weight: var(--weight-semibold);
    white-space: nowrap;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  td {
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-bevel-mid);
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover td {
    background: var(--color-accent-light);
  }

  .col-description {
    width: 100%;
  }
  .col-amount {
    width: 7rem;
  }
  .col-offset {
    min-width: 18rem;
  }
  .col-skip {
    width: 3rem;
    text-align: center;
  }

  .cell-mono {
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .cell-amount {
    font-family: var(--font-mono);
    text-align: right;
    white-space: nowrap;
  }

  .cell-amount.positive {
    color: var(--color-amount-positive);
  }
  .cell-amount.negative {
    color: var(--color-amount-negative);
  }

  .cell-offset {
    padding: 0;
  }
  .cell-skip {
    text-align: center;
    vertical-align: middle;
  }

  .row-skipped td {
    opacity: 0.4;
  }
  .row-skipped .cell-skip {
    opacity: 1;
  }

  .dup-badge {
    display: inline-block;
    margin-left: var(--sp-xs);
    padding: 0 3px;
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    font-weight: var(--weight-semibold);
    background: #fff3cd;
    color: #856404;
    box-shadow: var(--shadow-raised);
    vertical-align: middle;
    cursor: default;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .row-transfer td {
    background: var(--color-window);
  }
  .row-transfer:hover td {
    background: var(--color-accent-light);
  }

  .cell-transfer-amount {
    font-family: var(--font-mono);
    white-space: nowrap;
    padding: var(--sp-xs) var(--sp-sm);
  }

  .transfer-from {
    color: var(--color-amount-negative);
  }
  .transfer-arrow {
    color: var(--color-text-muted);
    margin: 0 var(--sp-xs);
  }
  .transfer-to {
    color: var(--color-amount-positive);
  }

  .transfer-fee {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-top: 1px;
  }

  .transfer-accounts {
    display: flex;
    flex-direction: column;
  }

  .transfer-accounts :global(.wrapper:first-child .path-input) {
    border-bottom: 1px solid var(--color-bevel-mid);
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    border-top: 1px solid var(--color-bevel-mid);
    background: var(--color-window);
  }

  .action-buttons {
    display: flex;
    gap: var(--sp-sm);
  }

  .error {
    font-size: var(--text-sm);
    color: var(--color-danger);
  }
</style>
