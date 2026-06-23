<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte'
  import type { ExpenseGroup } from '$lib/api'
  import { groupName, categoryName, myShareRatio } from './import-helpers'

  interface Props {
    groups: ExpenseGroup[]
    groupId: string
    categoryId: string | null
    // The row's amount + currency, used to compute the user's share of the split.
    amount: string
    currency: string
    currentUserId: string
  }

  let { groups, groupId, categoryId, amount, currency, currentUserId }: Props = $props()

  let shareHint = $derived.by(() => {
    const group = groups.find((g) => g.id === groupId)
    const ratio = myShareRatio(group, currentUserId, categoryId)
    if (ratio === null) return null
    const raw = Math.abs(parseFloat(amount)) * ratio
    if (isNaN(raw)) return null
    return `${raw.toFixed(2)} ${currency}`
  })
</script>

<div class="fishpie-pills">
  <span class="fishpie-pill-hero">
    <Icon name="pie" size={11} />
    {categoryId ? categoryName(groups, groupId, categoryId) : groupName(groups, groupId)}
  </span>
  {#if categoryId && groups.length > 1}
    <span class="fishpie-pill-sub">{groupName(groups, groupId)}</span>
  {/if}
  {#if shareHint}
    <span class="fishpie-pill-share">
      <Icon name="pie-chart" size={9} />{shareHint}
    </span>
  {/if}
</div>

<style>
  .fishpie-pills {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: nowrap;
    min-width: 0;
  }

  .fishpie-pill-hero {
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

  .fishpie-pill-sub {
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

  .fishpie-pill-share {
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
</style>
