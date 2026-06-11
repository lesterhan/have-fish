<script lang="ts">
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import GroupSelect from './GroupSelect.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { tooltip } from '$lib/tooltip'
  import type { Account, RegularParsedTransaction, ExpenseGroup } from '$lib/api'
  import type { RowState } from './ImportPreviewPanel.svelte'
  import { groupName, groupExpenseAccountPath } from './import-helpers'

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
    isMultiCurrency,
    importAsLiabilities,
    defaultCurrency,
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
    if (!group) return null
    const me = group.members.find((m) => m.userId === currentUserId)
    if (!me) return null
    const totalWeight = group.members.reduce((s, m) => s + m.shareWeight, 0)
    if (totalWeight === 0) return null
    const ratio = me.shareWeight / totalWeight
    const raw = Math.abs(parseFloat(tx.amount)) * ratio
    if (isNaN(raw)) return null
    return `${raw.toFixed(2)} ${tx.currency ?? defaultCurrency}`
  })

  function displayAmount(amount: string): string {
    if (!importAsLiabilities) return amount
    const n = parseFloat(amount)
    return isNaN(n) ? amount : String(-n)
  }
</script>

<tr class:row-skipped={rowState.skipped}>
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
  <td>
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
      <div class="fishpie-pills">
        <span class="fishpie-pill-group">
          <Icon name="pie" size={11} />
          {groupName(groups, rowState.groupId)}
        </span>
        <span class="fishpie-pill-account">
          {groupExpenseAccountPath(groups, accounts, currentUserId, rowState.groupId)}
        </span>
        {#if shareHint}
          <span class="fishpie-pill-share">
            <Icon name="pie-chart" size={9} />{shareHint}
          </span>
        {/if}
      </div>
    {:else if !splitSelectOpen}
      <div class="offset-wrap">
        <AccountPathInput
          {accounts}
          bind:value={rowState.offsetAccountId}
          placeholder="Select or create…"
          oncreate={onaccountcreated}
        />
        {#if tx.suggestedOffsetAccountId}
          <span
            class="indicator-icon"
            use:tooltip={{ label: 'Pre-filled by import rule', always: true }}
          >
            <Icon name="computer" size={16} />
          </span>
        {/if}
      </div>
    {/if}
    {#if !rowState.groupId && splitSelectOpen}
      <GroupSelect
        {groups}
        anchorEl={offsetCellEl}
        onselect={(id) => { rowState.groupId = id }}
        onclose={onclosesplit}
      />
    {/if}
  </td>
  {#if showFishPie}
    <td class="cell-split">
      {#if !rowState.skipped}
        {#if rowState.groupId}
          <GradientButton
            square
            aria-label="Remove Fish Pie split"
            onclick={() => {
              rowState.groupId = null
              onclosesplit()
            }}
          >×</GradientButton>
        {:else}
          <GradientButton square aria-label="Split with group" onclick={onsplitopen}>
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

  .offset-wrap {
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
