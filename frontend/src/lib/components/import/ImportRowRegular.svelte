<script lang="ts">
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountPicker from '$lib/components/accounts/AccountPicker.svelte'
  import GroupSelect from './GroupSelect.svelte'
  import FishPiePills from './FishPiePills.svelte'
  import ImportDateCell from './ImportDateCell.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { tooltip } from '$lib/tooltip'
  import type { Account, RegularParsedTransaction, ExpenseGroup } from '$lib/api'
  import type { RowState } from './row-state'
  import type { RowStatus } from './review-status'

  interface Props {
    tx: RegularParsedTransaction
    rowState: RowState
    accounts: Account[]
    groups: ExpenseGroup[]
    currentUserId: string
    isMultiCurrency: boolean
    importAsLiabilities: boolean
    defaultCurrency: string
    splitSelectOpen: boolean
    showFishPie: boolean
    status: RowStatus
    index: number
    // A row with no merchant stem has nothing to build a rule pattern from.
    canSaveRule: boolean
    onsplitopen: () => void
    onclosesplit: () => void
    onaccountcreated: (account: Account) => void
    onedited: () => void
    onsaverule: () => void
  }

  let {
    tx,
    rowState = $bindable(),
    accounts,
    groups,
    currentUserId,
    isMultiCurrency,
    importAsLiabilities,
    defaultCurrency,
    splitSelectOpen,
    showFishPie,
    status,
    index,
    canSaveRule,
    onsplitopen,
    onclosesplit,
    onaccountcreated,
    onedited,
    onsaverule,
  }: Props = $props()

  // A resolved row renders as a compact label until touched. This calms a 200-row list and
  // — more importantly — avoids mounting hundreds of AccountPicker instances, each of which
  // carries its own search index and listbox.
  let editing = $state(false)
  let showPicker = $derived(editing || status === 'needs-review' || !rowState.offsetAccountId)

  function accountPath(id: string): string {
    return accounts.find((a) => a.id === id)?.path ?? ''
  }

  let offsetCellEl: HTMLElement | null = $state(null)
  // Anchors the group dropdown to the input column so it lines up with the field it
  // replaces. In plain imports (no-label) this resolves to the full cell, as before.
  let splitAnchorEl: HTMLElement | null = $state(null)

  // The split still matches what the rule suggested. Re-pointing the row at a different
  // group is the user's own choice, so the indicator drops off rather than crediting a
  // rule for it.
  let splitFromRule = $derived(
    !!tx.suggestedGroupId && rowState.groupId === tx.suggestedGroupId,
  )

  function displayAmount(amount: string): string {
    if (!importAsLiabilities) return amount
    const n = parseFloat(amount)
    return isNaN(n) ? amount : String(-n)
  }
</script>

<tr class:row-skipped={rowState.skipped} data-row-index={index} data-status={status}>
  <ImportDateCell date={tx.date} possibleDuplicate={rowState.possibleDuplicate} />
  <td class="cell-description" title={tx.description ?? ''}>
    {tx.description ?? '—'}
    {#if rowState.possibleDuplicate?.fishPieGroupName}
      <span class="fishpie-hint">
        · Fish Pie settlement in
        <a href="/fish-pie/{rowState.possibleDuplicate.fishPieGroupId}" class="fishpie-hint-link">
          {rowState.possibleDuplicate.fishPieGroupName}
        </a>
      </span>
    {/if}
  </td>
  <td
    class="cell-amount"
    class:positive={parseFloat(displayAmount(tx.amount)) > 0}
    class:negative={parseFloat(displayAmount(tx.amount)) < 0}
  >
    {displayAmount(tx.amount)}{#if isMultiCurrency}{tx.currency ?? defaultCurrency}{/if}
  </td>
  {#if !isMultiCurrency}<td>{tx.currency ?? defaultCurrency}</td>{/if}
  <td class="cell-offset" bind:this={offsetCellEl}>
    {#if rowState.groupId}
      <!-- Match the labelled-field gutter of the cross-currency rows so the column's left
           edge stays consistent. Plain (non-multi-currency) imports opt out via no-label. -->
      <div class="field" class:no-label={!isMultiCurrency}>
        {#if isMultiCurrency}<span class="field-label">split</span>{/if}
        <div class="pills-wrap">
          <FishPiePills
            {groups}
            groupId={rowState.groupId}
            categoryId={rowState.categoryId}
            amount={tx.amount}
            currency={tx.currency ?? defaultCurrency}
            {currentUserId}
          />
          {#if splitFromRule}
            <span
              class="indicator-icon"
              use:tooltip={{ label: `Pre-filled by import rule «${tx.matchedRulePattern ?? ''}»`, always: true }}
            >
              <Icon name="computer" size={16} />
            </span>
          {/if}
          {#if canSaveRule && status === 'done' && !rowState.skipped}
            <GradientButton
              square
              aria-label="Save as import rule"
              tooltip={`Always split “${tx.merchantKey}” this way`}
              onclick={onsaverule}
            >
              <Icon name="floppy" size={12} />
            </GradientButton>
          {/if}
        </div>
      </div>
    {:else if !splitSelectOpen}
      <div class="field" class:no-label={!isMultiCurrency}>
        {#if isMultiCurrency}<span class="field-label">to</span>{/if}
        <div class="offset-wrap">
          {#if showPicker}
            <AccountPicker
              {accounts}
              bind:value={rowState.offsetAccountId}
              placeholder="Select or create…"
              oncreate={onaccountcreated}
              oncommit={onedited}
            />
          {:else}
            <button
              type="button"
              class="account-label"
              onclick={() => (editing = true)}
              onfocus={() => (editing = true)}
            >
              {accountPath(rowState.offsetAccountId)}
            </button>
          {/if}
          {#if tx.suggestedOffsetAccountId && status === 'auto'}
            <span
              class="indicator-icon"
              use:tooltip={{ label: `Pre-filled by import rule «${tx.matchedRulePattern ?? ''}»`, always: true }}
            >
              <Icon name="computer" size={16} />
            </span>
          {/if}
          {#if canSaveRule && status === 'done' && !rowState.skipped}
            <GradientButton
              square
              aria-label="Save as import rule"
              tooltip={`Always send “${tx.merchantKey}” here`}
              onclick={onsaverule}
            >
              <Icon name="floppy" size={12} />
            </GradientButton>
          {/if}
        </div>
      </div>
    {/if}
    {#if !rowState.groupId && splitSelectOpen}
      <div class="field" class:no-label={!isMultiCurrency}>
        {#if isMultiCurrency}<span class="field-label">split</span>{/if}
        <div class="split-anchor" bind:this={splitAnchorEl}>
          <GroupSelect
            {groups}
            anchorEl={splitAnchorEl}
            onselect={(id, catId) => {
              rowState = { ...rowState, groupId: id, categoryId: catId }
              onedited()
            }}
            onclose={onclosesplit}
          />
        </div>
      </div>
    {/if}
  </td>
  {#if showFishPie}
    <td class="cell-split">
      {#if !rowState.skipped}
        {#if rowState.groupId}
          <GradientButton
            square
            size="lg"
            aria-label="Remove Fish Pie split"
            onclick={() => {
              rowState = { ...rowState, groupId: null, categoryId: null }
              onclosesplit()
              onedited()
            }}
          ><Icon name="close" size={16} /></GradientButton>
        {:else}
          <GradientButton square size="lg" aria-label="Split with group" onclick={onsplitopen}>
            <Icon name="pie" size={16} />
          </GradientButton>
        {/if}
      {/if}
    </td>
  {/if}
  <td class="cell-skip">
    <input type="checkbox" bind:checked={rowState.skipped} onchange={onedited} />
  </td>
</tr>

<style>
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

  /* Pad the labelled field to match the cross-currency rows' .transfer-accounts inset, so
     the To-account column's gutter lines up across both row types. (no-label is
     display:contents and ignores this — plain imports stay flush.) */
  .field {
    padding: var(--sp-xs) var(--sp-sm);
  }

  /* Resolved rows show their account as text; the picker mounts on demand. */
  .account-label {
    flex: 1;
    padding: 3px var(--sp-xs);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-align: left;
    cursor: text;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }

  .account-label:hover {
    border-color: var(--color-border);
    background: var(--color-window-inset);
  }

  .account-label:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  .offset-wrap {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    /* Cap the lone account input so it doesn't span the full (now-greedy) column. */
    max-width: 30rem;
  }

  /* Same row treatment as .offset-wrap, uncapped — pills size to their content and
     already wrap on their own. */
  .pills-wrap {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
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
</style>
