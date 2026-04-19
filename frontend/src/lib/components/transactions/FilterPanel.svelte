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

  // searchExpanded covers both: entering new path AND editing existing pill
  let searchExpanded = $state(untrack(() => !!accountPath))
  let draft = $state(untrack(() => accountPath))

  $effect(() => {
    draft = accountPath
  })

  let accounts = $state<{ id: string; path: string }[]>([])
  onMount(async () => {
    accounts = await fetchAccounts()
  })

  function focusFirst(node: HTMLElement) {
    node.querySelector('input')?.focus()
  }

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

  function handleCommit(path: string) {
    searchExpanded = false
    if (path !== accountPath) onAccountPathChange?.(path)
  }

  function handleBlurWithNoCommit() {
    // If there's an active path, collapse back to pill. Otherwise close search.
    searchExpanded = false
    draft = accountPath
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
      {#if accountPath && !searchExpanded}
        <!-- Pill state: click to re-edit -->
        <span class="active-filter-chip">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="chip-text chip-clickable"
            onclick={() => (searchExpanded = true)}
          >{accountPath}</span>
          <button
            class="chip-clear"
            onclick={handleClear}
            aria-label="Clear filter">×</button
          >
        </span>
      {:else if searchExpanded}
        <!-- Inline input state -->
        <GradientButton
          onclick={toggleSearch}
          square
          tooltip="Close search"
          active
        >
          <Icon name="search" />
        </GradientButton>
        <div class="search-input-wrap" use:focusFirst>
          <AccountPathInput
            {accounts}
            bind:value={draft}
            placeholder="expenses:food"
            searchOnly={true}
            oncommit={handleCommit}
          />
        </div>
      {:else}
        <!-- Default: search toggle button -->
        <GradientButton
          onclick={toggleSearch}
          square
          tooltip="Filter by account path"
        >
          <Icon name="search" />
        </GradientButton>
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
    <GradientButton
      square
      tooltip="Reset to last 3 months"
      onclick={handleReset}
    >
      <Icon name="reset" />
    </GradientButton>
  </div>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
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
    align-items: center;
    gap: var(--sp-xs);
    margin-left: auto;
  }

  .search-input-wrap {
    width: 14rem;
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
    max-width: 16rem;
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

  .chip-clickable {
    cursor: text;
  }

  .chip-clickable:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
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

    .search-input-wrap {
      width: 10rem;
    }
  }
</style>
