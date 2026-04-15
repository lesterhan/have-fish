<script lang="ts">
  import { untrack } from 'svelte'
  import Panel from '$lib/components/ui/Panel.svelte'
  import Button from '$lib/components/ui/Button.svelte'
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

  // Expand the search row if a filter is already active (e.g. on page load from URL)
  let searchExpanded = $state(untrack(() => !!accountPath))
  // Local draft bound to AccountPathInput (path string in searchOnly mode)
  let draft = $state(untrack(() => accountPath))

  // Keep draft in sync if the URL changes externally (e.g. browser back)
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

<Panel title="Filter">
  <div class="bar">
    <div class="left-controls">
      {#if onAccountPathChange}
        <Button
          onclick={toggleSearch}
          square
          tooltip="Filter by account path"
          variant={accountPath ? 'primary' : undefined}
        >
          <Icon name="search" />
          {#if accountPath}<span class="filter-path">{accountPath}</span>{/if}
        </Button>
      {/if}
      <Button
        onclick={() => onSortChange(sortDir === 'desc' ? 'asc' : 'desc')}
        tooltip="Sort by date"
        square
      >
        <Icon name="calendar-{sortDir === 'desc' ? 'desc' : 'asc'}" />
      </Button>
      {#if actionRequiredCount !== null && actionRequiredCount > 0}
        <Button
          variant="warning"
          active={actionRequiredActive}
          onclick={onActionRequiredToggle}
          tooltip="Actions required"
        >
          <Icon name="warning" />
          ({actionRequiredCount})
        </Button>
      {:else if actionRequiredCount === 0}
        <Button disabled square tooltip="No actions required">
          <Icon name="check" />
        </Button>
      {/if}
    </div>
    <div class="date-controls">
      <DateRangeSelector
        value={{ from, to }}
        onchange={(r) => onApply(r.from, r.to)}
      />
      <Button square tooltip="Reset to last 3 months" onclick={handleReset}>
        <Icon name="reset" />
      </Button>
    </div>
  </div>

  {#if searchExpanded}
    <div class="search-row">
      <span class="search-prefix">account path</span>
      {#if accountPath}
        <button
          class="clear-btn"
          onclick={handleClear}
          aria-label="Clear account filter">×</button
        >
      {/if}
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
</Panel>

<style>
  .bar {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
  }

  @media (max-width: 520px) {
    .bar {
      flex-wrap: wrap;
    }

    .date-controls {
      margin-left: 0;
    }
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

  /* Account search row */
  .search-row {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm) var(--sp-sm);
    border-top: 1px solid var(--color-bevel-dark);
  }

  .search-prefix {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .search-input-wrap {
    flex: 1;
  }

  .clear-btn {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    background: none;
    border: none;
    color: var(--color-text-muted);
    font-size: var(--text-base);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    transition: color var(--duration-fast) var(--ease);
    padding: 0;
  }

  .clear-btn:hover {
    color: var(--color-danger);
  }

  .filter-path {
    font-size: var(--text-xs);
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
