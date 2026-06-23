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
  import { groupName, categoryName, myShareRatio } from './import-helpers'

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

  let offsetCellEl: HTMLElement | null = $state(null)

  let shareHint = $derived.by(() => {
    if (!rowState.groupId) return null
    const group = groups.find((g) => g.id === rowState.groupId)
    const ratio = myShareRatio(group, currentUserId, rowState.categoryId)
    if (ratio === null) return null
    const amountStr = tx.isTransfer === true ? tx.targetAmount : tx.amount
    const currency = tx.isTransfer === true ? tx.targetCurrency : tx.currency
    const raw = Math.abs(parseFloat(amountStr)) * ratio
    if (isNaN(raw)) return null
    return `${raw.toFixed(2)} ${currency}`
  })

  let feeAccountPath = $derived(
    rowState.feeAccountId
      ? (accounts.find((a) => a.id === rowState.feeAccountId)?.path ?? null)
      : null
  )

  let conversionAccountPath = $derived(
    rowState.conversionAccountId
      ? (accounts.find((a) => a.id === rowState.conversionAccountId)?.path ?? null)
      : null
  )

  // Cross-currency rows are spend-by-default; convert-and-park is the flagged exception.
  // A spend has no target asset and no Fish Pie split — it posts to an expense account.
  let isSpend = $derived(tx.isTransfer === true && rowState.kind === 'spend')

  function toggleKind() {
    const next = rowState.kind === 'spend' ? 'transfer' : 'spend'
    rowState = {
      ...rowState,
      kind: next,
      // A spend can't be a Fish Pie split — drop any group when flipping to spend.
      groupId: next === 'spend' ? null : rowState.groupId,
      categoryId: next === 'spend' ? null : rowState.categoryId,
    }
  }
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
      <span class="transfer-arrow">{isSpend ? '↘' : '→'}</span>
      <span class="transfer-to" class:is-spend={isSpend}
        >{tx.targetAmount} {tx.targetCurrency}</span
      >
      <span class="kind-tag" class:kind-spend={isSpend}>
        {isSpend ? 'spend' : 'convert'}
      </span>
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

  <td class="cell-offset" bind:this={offsetCellEl}>
    <div class="transfer-accounts">
      {#if rowState.groupId}
        <div class="fishpie-pills">
          <span class="fishpie-pill-hero">
            <Icon name="pie" size={11} />
            {rowState.categoryId
              ? categoryName(groups, rowState.groupId, rowState.categoryId)
              : groupName(groups, rowState.groupId)}
          </span>
          {#if rowState.categoryId && groups.length > 1}
            <span class="fishpie-pill-sub">
              {groupName(groups, rowState.groupId)}
            </span>
          {/if}
          {#if shareHint}
            <span class="fishpie-pill-share">
              <Icon name="pie-chart" size={9} />{shareHint}
            </span>
          {/if}
        </div>
      {:else if !splitSelectOpen}
        {#if tx.isTransfer === true}
          <button
            type="button"
            class="kind-flip"
            onclick={toggleKind}
            use:tooltip={{
              label: isSpend
                ? 'This is actually a conversion into an account you hold'
                : 'This is actually a spend in a currency you don’t hold',
              always: true,
            }}
          >
            <Icon name="exchange" size={11} />
            {isSpend ? 'Mark as conversion' : 'Mark as spend'}
          </button>
          {#if isSpend}
            <AccountPathInput
              {accounts}
              bind:value={rowState.expenseAccountId}
              placeholder="expenses:food…"
              oncreate={onaccountcreated}
            />
            {#if conversionAccountPath}
              <span class="fee-pill">
                <Icon name="exchange" size={10} /><code>{conversionAccountPath}</code>
                <button
                  type="button"
                  class="pill-remove"
                  onclick={() => { rowState.conversionAccountId = '' }}>×</button
                >
              </span>
            {:else}
              <AccountPathInput
                {accounts}
                bind:value={rowState.conversionAccountId}
                placeholder="equity:conversion…"
                oncreate={onaccountcreated}
              />
            {/if}
          {:else}
            <AccountPathInput
              {accounts}
              bind:value={rowState.conversionAccountId}
              placeholder="equity:conversion…"
              oncreate={onaccountcreated}
            />
          {/if}
        {:else}
          <AccountPathInput
            {accounts}
            bind:value={rowState.offsetAccountId}
            placeholder="Source account…"
            oncreate={onaccountcreated}
          />
        {/if}
      {/if}
      {#if !rowState.groupId && splitSelectOpen}
        <GroupSelect
          {groups}
          anchorEl={offsetCellEl}
          onselect={(id, catId) => { rowState = { ...rowState, groupId: id, categoryId: catId } }}
          onclose={onclosesplit}
        />
      {/if}
      {#if feeAccountPath}
        <span class="fee-pill">
          <Icon name="coin" size={10} /><code>{feeAccountPath}</code>
          <button type="button" class="pill-remove" onclick={() => { rowState.feeAccountId = '' }}>×</button>
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
      {#if !rowState.skipped && !isSpend}
        {#if rowState.groupId}
          <GradientButton
            square
            aria-label="Remove group split"
            onclick={() => {
              rowState = { ...rowState, groupId: null, categoryId: null }
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
  .transfer-to.is-spend {
    color: var(--color-amount-negative);
  }
  .transfer-fee {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-top: 1px;
  }

  .kind-tag {
    display: inline-block;
    margin-left: var(--sp-xs);
    padding: 0 4px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--color-text-muted);
    background: var(--color-window-raised);
    border: 1px solid var(--color-rule);
  }
  .kind-tag.kind-spend {
    color: var(--color-amount-negative);
    background: var(--color-danger-light);
    border-color: var(--color-amount-negative);
  }

  .kind-flip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    align-self: flex-start;
    margin-bottom: 2px;
    padding: 1px 5px;
    background: none;
    border: 1px solid var(--color-rule);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }
  .kind-flip:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
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
    gap: 3px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .fee-pill code {
    color: var(--color-text-muted);
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
