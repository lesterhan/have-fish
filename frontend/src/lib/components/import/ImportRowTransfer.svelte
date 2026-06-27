<script lang="ts">
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountPicker from '$lib/components/accounts/AccountPicker.svelte'
  import GroupSelect from './GroupSelect.svelte'
  import FishPiePills from './FishPiePills.svelte'
  import ImportDateCell from './ImportDateCell.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { tooltip } from '$lib/tooltip'
  import type {
    Account,
    TransferParsedTransaction,
    SameCurrencyTransferParsedTransaction,
    ExpenseGroup,
  } from '$lib/api'
  import type { RowState } from './ImportPreviewPanel.svelte'

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
  // Anchors the group dropdown to the input column (inside the label gutter) rather than
  // the whole cell, so it lines up with the field it replaces instead of jumping flush-left.
  let splitAnchorEl: HTMLElement | null = $state(null)

  // The leg the Fish Pie split is measured against: the target (what was actually spent) for
  // a cross-currency row, or the single amount for a same-currency transfer.
  let splitAmount = $derived(tx.isTransfer === true ? tx.targetAmount : tx.amount)
  let splitCurrency = $derived(tx.isTransfer === true ? tx.targetCurrency : tx.currency)

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
  // A spend posts to an expense account and *can* be shared (Fish Pie). A convert is an
  // internal move between the user's own currency accounts — nothing to split.
  let isSpend = $derived(tx.isTransfer === true && rowState.kind === 'spend')
  let isConvert = $derived(tx.isTransfer === true && rowState.kind === 'transfer')

  // A convert and a same-currency transfer always post a fee leg; a spend only when the
  // row actually carries a fee. Hiding the empty fee field for the common fee-less spend
  // removes a needless input. Grouped spends still need it (the Fish Pie path posts a fee).
  let showFee = $derived(!(isSpend && !rowState.groupId && !tx.feeAmount))

  function toggleKind() {
    const next = rowState.kind === 'spend' ? 'transfer' : 'spend'
    // Changing the kind invalidates any group split — a convert can't be shared at all, and
    // the split would otherwise be stranded. Clear it on either flip.
    rowState = { ...rowState, kind: next, groupId: null, categoryId: null }
  }
</script>

<tr class="row-transfer" class:row-skipped={rowState.skipped}>
  <ImportDateCell date={tx.date} possibleDuplicate={rowState.possibleDuplicate} />
  <td class="cell-description" title={tx.description ?? ''}>{tx.description ?? '—'}</td>

  {#if tx.isTransfer === true}
    <td class="cell-transfer-amount">
      <span class="amt-source">{tx.sourceAmount} {tx.sourceCurrency}</span>
      <span class="amt-target" class:is-spend={isSpend}>
        <span class="amt-arrow">{isSpend ? '↘' : '→'}</span>{tx.targetAmount} {tx.targetCurrency}
      </span>
      {#if tx.feeAmount}
        <span class="amt-fee">fee {tx.feeAmount} {tx.feeCurrency ?? tx.sourceCurrency}</span>
      {/if}
    </td>
  {:else}
    <td class="cell-transfer-amount">
      <span class="amt-target">+{tx.amount} {tx.currency}</span>
      <span class="amt-fee">fee {tx.feeAmount} {tx.currency}</span>
    </td>
  {/if}

  <td class="cell-offset" bind:this={offsetCellEl}>
    <div class="transfer-accounts">
      {#if rowState.groupId}
        <div class="field">
          <span class="field-label">split</span>
          <FishPiePills
            {groups}
            groupId={rowState.groupId}
            categoryId={rowState.categoryId}
            amount={splitAmount}
            currency={splitCurrency}
            {currentUserId}
          />
        </div>
      {:else if !splitSelectOpen}
        {#if tx.isTransfer === true}
          {#if isSpend}
            <div class="field">
              <span class="field-label">expense</span>
              <AccountPicker
                {accounts}
                bind:value={rowState.expenseAccountId}
                placeholder="expenses:food…"
                oncreate={onaccountcreated}
              />
            </div>
            <div class="field">
              <span class="field-label">via</span>
              {#if conversionAccountPath}
                <span class="field-pill">
                  <Icon name="exchange" size={10} /><code>{conversionAccountPath}</code>
                  <button
                    type="button"
                    class="pill-remove"
                    onclick={() => { rowState.conversionAccountId = '' }}>×</button
                  >
                </span>
              {:else}
                <AccountPicker
                  {accounts}
                  bind:value={rowState.conversionAccountId}
                  placeholder="equity:conversion…"
                  oncreate={onaccountcreated}
                />
              {/if}
            </div>
          {:else}
            <div class="field">
              <span class="field-label">via</span>
              <AccountPicker
                {accounts}
                bind:value={rowState.conversionAccountId}
                placeholder="equity:conversion…"
                oncreate={onaccountcreated}
              />
            </div>
          {/if}
        {:else}
          <div class="field">
            <span class="field-label">source</span>
            <AccountPicker
              {accounts}
              bind:value={rowState.offsetAccountId}
              placeholder="Source account…"
              oncreate={onaccountcreated}
            />
          </div>
        {/if}
      {/if}
      {#if !rowState.groupId && splitSelectOpen}
        <div class="field">
          <span class="field-label">split</span>
          <div class="split-anchor" bind:this={splitAnchorEl}>
            <GroupSelect
              {groups}
              anchorEl={splitAnchorEl}
              onselect={(id, catId) => { rowState = { ...rowState, groupId: id, categoryId: catId } }}
              onclose={onclosesplit}
            />
          </div>
        </div>
      {/if}
      {#if showFee && !splitSelectOpen}
        <div class="field">
          <span class="field-label">fee</span>
          {#if feeAccountPath}
            <span class="field-pill">
              <Icon name="coin" size={10} /><code>{feeAccountPath}</code>
              <button type="button" class="pill-remove" onclick={() => { rowState.feeAccountId = '' }}>×</button>
            </span>
          {:else}
            <AccountPicker
              {accounts}
              bind:value={rowState.feeAccountId}
              placeholder="expenses:fees…"
              oncreate={onaccountcreated}
            />
          {/if}
        </div>
      {/if}

      {#if tx.isTransfer === true && !rowState.groupId && !splitSelectOpen}
        <button
          type="button"
          class="kind-flip"
          onclick={toggleKind}
          use:tooltip={{
            label: isSpend
              ? 'Actually a conversion into an account you hold — not a spend'
              : 'Actually a spend in a currency you don’t hold — not a conversion',
            always: true,
          }}
        >
          <Icon name="exchange" size={10} />
          {isSpend ? 'Switch to conversion' : 'Switch to spend'}
        </button>
      {/if}
    </div>
  </td>

  {#if showFishPie}
    <td class="cell-split">
      {#if !rowState.skipped && !isConvert}
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
  /* Amounts are the load-bearing column: right-align the legs so every row's numbers
     share a common edge with the regular rows, top to bottom. */
  .cell-transfer-amount {
    font-family: var(--font-mono);
    white-space: nowrap;
    text-align: right;
    padding: var(--sp-xs) var(--sp-sm);
  }
  .cell-transfer-amount > span {
    display: block;
  }

  .amt-source {
    color: var(--color-amount-negative);
  }
  .amt-target {
    color: var(--color-amount-positive);
  }
  /* A spend lands in an expense account — colour it like an expense (the arrow agrees: ↘). */
  .amt-target.is-spend {
    color: var(--color-amount-negative);
  }
  .amt-arrow {
    margin-right: 2px;
    color: var(--color-text-muted);
  }
  .amt-fee {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-top: 1px;
  }

  .kind-flip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    align-self: flex-start;
    /* Align the flip under the input column, past the label gutter. */
    margin-left: calc(3rem + var(--sp-xs));
    margin-top: 2px;
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
    gap: 3px;
    padding: var(--sp-xs) var(--sp-sm);
  }

  .field-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .field-pill code {
    overflow: hidden;
    text-overflow: ellipsis;
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
