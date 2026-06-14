<script lang="ts">
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import Toggle from '$lib/components/ui/Toggle.svelte'
  import type { Account, ImportPreviewResult, PossibleDuplicate, ExpenseGroup } from '$lib/api'
  import ImportRowTransfer from './ImportRowTransfer.svelte'
  import ImportRowRegular from './ImportRowRegular.svelte'

  export type RowState = {
    offsetAccountId: string
    conversionAccountId: string
    feeAccountId: string
    skipped: boolean
    possibleDuplicate?: PossibleDuplicate
    groupId: string | null
    // Meaningful only when groupId is set; null = uncategorized fish-pie split.
    categoryId: string | null
  }

  interface Props {
    preview: ImportPreviewResult
    rowStates: RowState[]
    accounts: Account[]
    groups: ExpenseGroup[]
    currentUserId: string
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
    groups,
    currentUserId,
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

  let splitSelectOpenIndex = $state<number | null>(null)

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
        // Fish Pie rows: backend derives the offset account (shared:<group>) automatically
        return !row.groupId && !row.offsetAccountId
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
          Import account
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
        <p>{preview.errors.length} row(s) could not be parsed and will be skipped.</p>
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
      <Toggle bind:checked={importAsLiabilities} label="Import as liabilities" />
      <div class="bar-actions">
        <GradientButton onclick={oncancel}>Cancel</GradientButton>
        <GradientButton onclick={onconfirm} disabled={confirmDisabled} active>
          {loading ? 'Importing…' : 'Confirm import'}
        </GradientButton>
      </div>
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
            {#if groups.length > 0}<th class="col-split">Fish Pie</th>{/if}
            <th class="col-skip">Skip</th>
          </tr>
        </thead>
        <tbody>
          {#each preview.transactions as tx, i}
            {#if tx.isTransfer === false}
              <ImportRowRegular
                {tx}
                bind:rowState={rowStates[i]}
                {accounts}
                {groups}
                {currentUserId}
                isMultiCurrency={preview.isMultiCurrency}
                {importAsLiabilities}
                {defaultCurrency}
                splitSelectOpen={splitSelectOpenIndex === i}
                showFishPie={groups.length > 0}
                onsplitopen={() => (splitSelectOpenIndex = i)}
                onclosesplit={() => (splitSelectOpenIndex = null)}
                {onaccountcreated}
              />
            {:else}
              <ImportRowTransfer
                {tx}
                bind:rowState={rowStates[i]}
                {accounts}
                {groups}
                {currentUserId}
                splitSelectOpen={splitSelectOpenIndex === i}
                showFishPie={groups.length > 0}
                onsplitopen={() => (splitSelectOpenIndex = i)}
                onclosesplit={() => (splitSelectOpenIndex = null)}
                {onaccountcreated}
              />
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
      <GradientButton onclick={onconfirm} disabled={confirmDisabled} active>
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
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
    font-size: var(--text-sm);
  }

  .account-row :global(.wrapper) {
    flex: 1;
  }

  .field-label {
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .required {
    color: var(--color-amount-negative);
  }

  .parse-errors {
    font-size: var(--text-sm);
    color: var(--color-danger);
    background: var(--color-danger-light);
    border-left: 3px solid var(--color-danger);
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-rule);
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
    background: var(--color-warning-light);
    border-left: 3px solid var(--color-warning);
    border-bottom: 1px solid var(--color-rule);
    font-size: var(--text-sm);
  }

  .missing-label {
    font-weight: var(--weight-semibold);
    margin-right: var(--sp-xs);
    color: var(--color-warning);
  }

  .missing-account {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-xs);
    background: var(--color-window);
    border: 1px solid var(--color-border);
    padding: 0 var(--sp-xs);
  }

  .missing-account code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .liability-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
  }

  .bar-actions {
    display: flex;
    gap: var(--sp-sm);
  }

  /* ── Table structure ── */

  .table-container {
    background: var(--color-window-inset);
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th {
    background: var(--color-window);
    box-shadow: none;
    border-bottom: 1px solid var(--color-rule);
    padding: 4px 12px;
    text-align: left;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    white-space: nowrap;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .col-description { width: 100%; }
  .col-amount      { width: 7rem; }
  .col-offset      { min-width: 18rem; }
  .col-split       { width: 7rem; text-align: center; }
  .col-skip        { width: 3rem; text-align: center; }

  /* ── Shared row/cell styles — :global so they reach child-rendered <td> elements ── */

  :global(.table-container td) {
    padding: 5px 12px;
    border-bottom: 1px solid var(--color-rule-soft);
    font-size: var(--text-xs);
  }

  :global(.table-container tbody tr:last-child td) {
    border-bottom: none;
  }

  :global(.table-container tbody tr:hover td) {
    background: var(--color-accent-light);
  }

  :global(.table-container .cell-mono) {
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  :global(.table-container .cell-offset) {
    padding: 0;
  }

  :global(.table-container .cell-skip) {
    text-align: center;
    vertical-align: middle;
  }

  :global(.table-container .cell-split) {
    text-align: center;
    vertical-align: middle;
    padding: 2px 4px;
    white-space: nowrap;
  }

  :global(.table-container .row-skipped td) {
    opacity: 0.4;
  }

  :global(.table-container .row-skipped .cell-skip) {
    opacity: 1;
  }

  :global(.table-container .indicator-icon) {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--color-accent);
    cursor: default;
    vertical-align: middle;
    margin-left: var(--sp-xs);
  }

  :global(.table-container .fishpie-pills) {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: nowrap;
    min-width: 0;
  }

  :global(.table-container .fishpie-pill-share) {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    background: var(--color-window-raised);
    border: 1px solid var(--color-rule);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  :global(.table-container .fishpie-pill-group) {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    background: var(--color-accent-light);
    border: 1px solid var(--color-accent);
    color: var(--color-accent-chip-fg);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 1;
    min-width: 0;
  }

  :global(.table-container .fishpie-pill-account) {
    display: inline-block;
    padding: 2px 6px;
    background: var(--color-window-raised);
    border: 1px solid var(--color-rule);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 2;
    min-width: 0;
  }

  /* ── Panel footer ── */

  .panel-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    border-top: 1px solid var(--color-rule);
    background: linear-gradient(
      180deg,
      var(--color-window),
      var(--color-window-raised)
    );
  }

  .error {
    flex: 1;
    font-size: var(--text-xs);
    color: var(--color-danger);
  }

  .action-buttons {
    display: flex;
    gap: var(--sp-sm);
    margin-left: auto;
  }
</style>
