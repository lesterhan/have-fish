<script lang="ts">
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import GroupSelect from './GroupSelect.svelte'
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

  let feeAccountPath = $derived(
    rowState.feeAccountId
      ? (accounts.find((a) => a.id === rowState.feeAccountId)?.path ?? null)
      : null
  )
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
        <GroupSelect
          {groups}
          onselect={(id) => { rowState.groupId = id }}
          onclose={onclosesplit}
        />
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
      {#if feeAccountPath}
        <span class="fee-pill">
          Fee: <code>{feeAccountPath}</code>
          <button class="pill-remove" onclick={() => { rowState.feeAccountId = '' }}>×</button>
        </span>
      {:else}
        <AccountPathInput
          {accounts}
          bind:value={rowState.feeAccountId}
          placeholder="expenses:fees…"
          oncreate={onaccountcreated}
        />
      {/if}
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

  .fee-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 var(--sp-xs);
    background: var(--color-window-raised);
    border: 1px solid var(--color-rule);
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .fee-pill code {
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .pill-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-muted);
    padding: 0 2px;
    font-size: 13px;
    line-height: 1;
  }

  .pill-remove:hover {
    color: var(--color-danger);
  }
</style>
