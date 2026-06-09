<script lang="ts">
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import Toggle from '$lib/components/ui/Toggle.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { tooltip } from '$lib/tooltip'
  import type { Account, ImportPreviewResult, PossibleDuplicate, ExpenseGroup } from '$lib/api'

  export type RowState = {
    offsetAccountId: string
    conversionAccountId: string
    feeAccountId: string
    skipped: boolean
    possibleDuplicate?: PossibleDuplicate
    groupId: string | null
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

  function groupName(id: string | null): string {
    if (!id) return ''
    return groups.find((g) => g.id === id)?.name ?? ''
  }

  function groupExpenseAccountPath(groupId: string | null): string {
    if (!groupId) return ''
    const group = groups.find((g) => g.id === groupId)
    if (!group) return ''
    const member = group.members.find((m) => m.userId === currentUserId)
    if (!member || !member.defaultExpenseAccountId) return 'uncategorized'
    return accounts.find((a) => a.id === member.defaultExpenseAccountId)?.path ?? 'uncategorized'
  }

  function clearGroupSplit(i: number) {
    rowStates[i].groupId = null
    splitSelectOpenIndex = null
  }

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
            <GradientButton onclick={() => oncreatemissing(path)}
              >Create</GradientButton
            >
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
            {#if groups.length > 0}<th class="col-split">Fish Pie</th>{/if}
            <th class="col-skip">Skip</th>
          </tr>
        </thead>
        <tbody>
          {#each preview.transactions as tx, i}
            {#if tx.isTransfer === true}
              <tr class="row-transfer" class:row-skipped={rowStates[i].skipped}>
                <td class="cell-mono">
                  {new Date(tx.date).toLocaleDateString()}
                  {#if rowStates[i].possibleDuplicate}
                    <span
                      class="indicator-icon"
                      use:tooltip={{
                        label: `Possible duplicate: ${rowStates[i].possibleDuplicate!.date} ${rowStates[i].possibleDuplicate!.amount} ${rowStates[i].possibleDuplicate!.currency}`,
                        always: true,
                      }}
                    >
                      <Icon name="warning-filled" size={16} />
                    </span>
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
                {#if groups.length > 0}<td class="cell-split"></td>{/if}
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
                  {#if rowStates[i].possibleDuplicate}
                    <span
                      class="indicator-icon"
                      use:tooltip={{
                        label: `Possible duplicate: ${rowStates[i].possibleDuplicate!.date} ${rowStates[i].possibleDuplicate!.amount} ${rowStates[i].possibleDuplicate!.currency}`,
                        always: true,
                      }}
                    >
                      <Icon name="warning-filled" size={16} />
                    </span>
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
                {#if groups.length > 0}<td class="cell-split"></td>{/if}
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
                  {#if rowStates[i].possibleDuplicate}
                    <span
                      class="indicator-icon"
                      use:tooltip={{
                        label: `Possible duplicate: ${rowStates[i].possibleDuplicate!.date} ${rowStates[i].possibleDuplicate!.amount} ${rowStates[i].possibleDuplicate!.currency}`,
                        always: true,
                      }}
                    >
                      <Icon name="warning-filled" size={16} />
                    </span>
                  {/if}
                </td>
                <td>
                  {tx.description ?? '—'}
                  {#if rowStates[i].possibleDuplicate?.fishPieGroupName}
                    <span class="fishpie-hint">
                      · Fish Pie settlement in
                      <a href="/fish-pie/{rowStates[i].possibleDuplicate!.fishPieGroupId}" class="fishpie-hint-link">
                        {rowStates[i].possibleDuplicate!.fishPieGroupName}
                      </a>
                    </span>
                  {/if}
                </td>
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
                  {#if rowStates[i].groupId}
                    <div class="fishpie-pills">
                      <span class="fishpie-pill-group">
                        <Icon name="pie" size={11} />
                        {groupName(rowStates[i].groupId)}
                      </span>
                      <span class="fishpie-pill-account">
                        {groupExpenseAccountPath(rowStates[i].groupId)}
                      </span>
                    </div>
                  {:else if splitSelectOpenIndex === i}
                    <select
                      class="split-select"
                      onchange={(e) => {
                        const val = (e.currentTarget as HTMLSelectElement).value
                        if (val) rowStates[i].groupId = val
                        splitSelectOpenIndex = null
                      }}
                      onblur={() => (splitSelectOpenIndex = null)}
                    >
                      <option value="">Choose group…</option>
                      {#each groups as g (g.id)}
                        <option value={g.id}>{g.name}</option>
                      {/each}
                    </select>
                  {:else}
                    <div class="offset-wrap">
                      <AccountPathInput
                        {accounts}
                        bind:value={rowStates[i].offsetAccountId}
                        placeholder="Select or create…"
                        oncreate={onaccountcreated}
                      />
                      {#if tx.suggestedOffsetAccountId}
                        <span
                          class="indicator-icon"
                          use:tooltip={{
                            label: 'Pre-filled by import rule',
                            always: true,
                          }}
                        >
                          <Icon name="computer" size={16} />
                        </span>
                      {/if}
                    </div>
                  {/if}
                </td>
                {#if groups.length > 0}
                  <td class="cell-split">
                    {#if !rowStates[i].skipped}
                      {#if rowStates[i].groupId}
                        <GradientButton square aria-label="Remove Fish Pie split" onclick={() => clearGroupSplit(i)}>×</GradientButton>
                      {:else}
                        <GradientButton square aria-label="Split with group" onclick={() => (splitSelectOpenIndex = i)}>
                          <Icon name="pie" size={12} />
                        </GradientButton>
                      {/if}
                    {/if}
                  </td>
                {/if}
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
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
  }

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

  td {
    padding: 5px 12px;
    border-bottom: 1px solid var(--color-rule-soft);
    font-size: var(--text-xs);
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
  .col-split {
    width: 7rem;
    text-align: center;
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

  .offset-wrap {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .indicator-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--color-accent);
    cursor: default;
    vertical-align: middle;
    margin-left: var(--sp-xs);
  }

  .fishpie-hint {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .fishpie-hint-link {
    color: var(--color-accent-mid);
    text-decoration: none;
  }

  .fishpie-hint-link:hover {
    text-decoration: underline;
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
    border-bottom: 1px solid var(--color-rule);
  }

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

  .cell-split {
    text-align: center;
    vertical-align: middle;
    padding: 2px 4px;
    white-space: nowrap;
  }


  .fishpie-pills {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: nowrap;
    min-width: 0;
  }

  .fishpie-pill-group {
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

  .fishpie-pill-account {
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

.split-select {
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    border: 1px solid var(--color-accent);
    background: var(--color-window);
    padding: 1px 2px;
    outline: none;
  }
</style>
