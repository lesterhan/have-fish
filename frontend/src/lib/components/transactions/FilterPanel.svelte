<script lang="ts">
  import { untrack } from 'svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import DateRangeSelector from '$lib/components/transactions/DateRangeSelector.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import { fetchAccounts } from '$lib/api'
  import { toISODate } from '$lib/date'
  import { onMount } from 'svelte'

  interface Props {
    from: string
    to: string
    sortDir: 'asc' | 'desc'
    accountPath?: string
    actionRequiredCount?: number | null
    actionRequiredActive?: boolean
    onApply: (from: string, to: string) => void
    onSortChange: (dir: 'asc' | 'desc') => void
    onAccountPathChange?: (path: string) => void
    onActionRequiredToggle?: () => void
  }

  let {
    from,
    to,
    sortDir,
    accountPath = '',
    actionRequiredCount = null,
    actionRequiredActive = false,
    onApply,
    onSortChange,
    onAccountPathChange,
    onActionRequiredToggle,
  }: Props = $props()

  let searchExpanded = $state(untrack(() => !!accountPath))
  let draft = $state(untrack(() => accountPath))

  $effect(() => {
    draft = accountPath
  })

  let accounts = $state<{ id: string; path: string }[]>([])
  onMount(async () => {
    accounts = await fetchAccounts()
  })

  function toggleSearch() {
    searchExpanded = !searchExpanded
    if (!searchExpanded) {
      if (accountPath) onAccountPathChange?.('')
      draft = ''
    }
  }

  function handleClear() {
    draft = ''
    onAccountPathChange?.('')
    searchExpanded = false
  }

  function handleReset() {
    const today = new Date()
    const f = new Date(today)
    f.setMonth(today.getMonth() - 3)
    onApply(toISODate(f), toISODate(today))
  }
</script>

<div class="bar">
  <div class="left-controls">
    {#if onAccountPathChange}
      <GradientButton
        onclick={toggleSearch}
        square
        tooltip="Filter by account path"
        active={!!accountPath}
      >
        <Icon name="search" />
      </GradientButton>
      {#if accountPath}
        <span class="active-filter-chip">
          <span class="chip-text">{accountPath}</span>
          <button class="chip-clear" onclick={handleClear} aria-label="Clear filter">×</button>
        </span>
      {/if}
    {/if}
    <GradientButton
      onclick={() => onSortChange(sortDir === 'desc' ? 'asc' : 'desc')}
      tooltip="Sort by date"
      square
    >
      <Icon name="calendar-{sortDir === 'desc' ? 'desc' : 'asc'}" />
    </GradientButton>
    {#if actionRequiredCount !== null && actionRequiredCount > 0}
      <GradientButton
        variant="warning"
        active={actionRequiredActive}
        onclick={onActionRequiredToggle}
        tooltip="Actions required"
      >
        <Icon name="warning" />
        ({actionRequiredCount})
      </GradientButton>
    {:else if actionRequiredCount === 0}
      <GradientButton disabled square tooltip="No actions required">
        <Icon name="check" />
      </GradientButton>
    {/if}
  </div>
  <div class="date-controls">
    <DateRangeSelector
      value={{ from, to }}
      onchange={(r) => onApply(r.from, r.to)}
    />
    <GradientButton square tooltip="Reset to last 3 months" onclick={handleReset}>
      <Icon name="reset" />
    </GradientButton>
  </div>
</div>

{#if searchExpanded}
  <div class="search-row">
    <span class="search-prefix">account path</span>
    <div class="search-input-wrap">
      <AccountPathInput
        {accounts}
        bind:value={draft}
        placeholder="expenses:food"
        searchOnly={true}
        oncommit={(path) => {
          if (path !== accountPath) onAccountPathChange?.(path)
        }}
      />
    </div>
  </div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
  }

  .left-controls {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .date-controls {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-xs);
    margin-left: auto;
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
    border-left: 1px solid var(--color-rule);
  }

  .search-prefix {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .search-input-wrap {
    flex: 1;
  }

  .active-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 20px;
    padding: 0 4px 0 7px;
    background: var(--color-accent-chip-bg);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-xl);
    max-width: 14rem;
    flex-shrink: 1;
    min-width: 0;
  }

  .chip-text {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-accent-chip-fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .chip-clear {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    background: none;
    border: none;
    color: var(--color-accent);
    font-size: 13px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    padding: 0;
    opacity: 0.7;
    transition: opacity var(--duration-fast) var(--ease);
  }

  .chip-clear:hover {
    opacity: 1;
  }

  @media (max-width: 520px) {
    .bar {
      flex-wrap: wrap;
    }

    .date-controls {
      margin-left: 0;
    }
  }
</style>
