<script lang="ts">
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { tooltip } from '$lib/tooltip'
  import type {
    Account,
    TransferParsedTransaction,
    SameCurrencyTransferParsedTransaction,
    ExpenseGroup,
  } from '$lib/api'
  import type { RowState } from './ImportPreviewPanel.svelte'
  import { groupName, groupExpenseAccountPath } from './import-helpers'

  interface Props {
    tx: TransferParsedTransaction | SameCurrencyTransferParsedTransaction
    rowState: RowState
    accounts: Account[]
    groups: ExpenseGroup[]
    currentUserId: string
    splitSelectOpen: boolean
    showFishPie: boolean
    onsplitopen: () => void
    onclosesplit: () => void
    onaccountcreated: (account: Account) => void
  }

  let {
    tx,
    rowState = $bindable(),
    accounts,
    groups,
    currentUserId,
    splitSelectOpen,
    showFishPie,
    onsplitopen,
    onclosesplit,
    onaccountcreated,
  }: Props = $props()
</script>

<tr class="row-transfer" class:row-skipped={rowState.skipped}>
  <td class="cell-mono">
    {new Date(tx.date).toLocaleDateString()}
    {#if rowState.possibleDuplicate}
      <span
        class="indicator-icon"
        use:tooltip={{
          label: `Possible duplicate: ${rowState.possibleDuplicate.date} ${rowState.possibleDuplicate.amount} ${rowState.possibleDuplicate.currency}`,
          always: true,
        }}
      >
        <Icon name="warning-filled" size={16} />
      </span>
    {/if}
  </td>
  <td>{tx.description ?? '—'}</td>

  {#if tx.isTransfer === true}
    <td class="cell-transfer-amount">
      <span class="transfer-from">{tx.sourceAmount} {tx.sourceCurrency}</span>
      <span class="transfer-arrow">→</span>
      <span class="transfer-to">{tx.targetAmount} {tx.targetCurrency}</span>
      {#if tx.feeAmount}
        <span class="transfer-fee"
          >fee: {tx.feeAmount} {tx.feeCurrency ?? tx.sourceCurrency}</span
        >
      {/if}
    </td>
  {:else}
    <td class="cell-transfer-amount">
      <span class="transfer-to">+{tx.amount} {tx.currency}</span>
      <span class="transfer-fee">fee: {tx.feeAmount} {tx.currency}</span>
    </td>
  {/if}

  <td class="cell-offset">
    <div class="transfer-accounts">
      {#if rowState.groupId}
        <div class="fishpie-pills">
          <span class="fishpie-pill-group">
            <Icon name="pie" size={11} />
            {groupName(groups, rowState.groupId)}
          </span>
          <span class="fishpie-pill-account">
            {groupExpenseAccountPath(
              groups,
              accounts,
              currentUserId,
              rowState.groupId,
            )}
          </span>
        </div>
      {:else if splitSelectOpen}
        <select
          class="split-select"
          onchange={(e) => {
            const val = (e.currentTarget as HTMLSelectElement).value
            if (val) rowState.groupId = val
            onclosesplit()
          }}
          onblur={onclosesplit}
        >
          <option value="">Choose group…</option>
          {#each groups as g (g.id)}
            <option value={g.id}>{g.name}</option>
          {/each}
        </select>
      {:else if tx.isTransfer === true}
        <AccountPathInput
          {accounts}
          bind:value={rowState.conversionAccountId}
          placeholder="equity:conversion…"
          oncreate={onaccountcreated}
        />
      {:else}
        <AccountPathInput
          {accounts}
          bind:value={rowState.offsetAccountId}
          placeholder="Source account…"
          oncreate={onaccountcreated}
        />
      {/if}
      <AccountPathInput
        {accounts}
        bind:value={rowState.feeAccountId}
        placeholder="expenses:fees…"
        oncreate={onaccountcreated}
      />
    </div>
  </td>

  {#if showFishPie}
    <td class="cell-split">
      {#if !rowState.skipped}
        {#if rowState.groupId}
          <GradientButton
            square
            aria-label="Remove group split"
            onclick={() => {
              rowState.groupId = null
              onclosesplit()
            }}>×</GradientButton
          >
        {:else}
          <GradientButton
            square
            aria-label="Split with group"
            onclick={onsplitopen}
          >
            <Icon name="pie" size={12} />
          </GradientButton>
        {/if}
      {/if}
    </td>
  {/if}

  <td class="cell-skip">
    <input type="checkbox" bind:checked={rowState.skipped} />
  </td>
</tr>

<style>
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
</style>
