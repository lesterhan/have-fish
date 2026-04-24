<script lang="ts">
  import {
    fetchTransactions,
    fetchAccounts,
    deleteTransaction,
    type Account,
  } from '$lib/api'
  import { bump as refreshSidebar } from '$lib/sidebarRefresh.svelte'
  import { settingsStore } from '$lib/settings.svelte'
  import AddTransactionModal from '$lib/components/transactions/AddTransactionModal.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import { toISODate } from '$lib/date'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import FilterPanel from '$lib/components/transactions/FilterPanel.svelte'
  import TransactionRow from '$lib/components/transactions/TransactionRow.svelte'
  import TransactionRowSkeleton from '$lib/components/transactions/TransactionRowSkeleton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { scrollShadow } from '$lib/scrollShadow'

  // Default range: last 90 days → today, computed once at module load.
  function defaultRange() {
    const today = new Date()
    const from = new Date(today)
    from.setDate(today.getDate() - 90)
    return {
      from: toISODate(from),
      to: toISODate(today),
    }
  }
  const defaults = defaultRange()

  // Read from URL search params, fall back to defaults if absent.
  let from = $derived(page.url.searchParams.get('from') ?? defaults.from)
  let to = $derived(page.url.searchParams.get('to') ?? defaults.to)
  let sortDir = $derived(
    (page.url.searchParams.get('dir') ?? 'desc') as 'asc' | 'desc',
  )
  let accountPath = $derived(page.url.searchParams.get('accountPath') ?? '')

  let transactions = $state<Awaited<ReturnType<typeof fetchTransactions>>>([])
  let accounts = $state<Account[]>([])
  let defaultOffsetAccountId = $state<string | null>(null)
  let defaultConversionAccountId = $state<string | null>(null)
  let loading = $state(true)
  let addModalOpen = $state(false)
  let selectMode = $state(false)
  let selectedIds = $state(new Set<string>())
  let deleting = $state(false)

  function toggleSelectMode() {
    selectMode = !selectMode
    selectedIds = new Set()
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds = next
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return
    deleting = true
    try {
      await Promise.all([...selectedIds].map((id) => deleteTransaction(id)))
      transactions = transactions.filter((t) => !selectedIds.has(t.id))
      selectedIds = new Set()
      selectMode = false
      refreshSidebar()
    } finally {
      deleting = false
    }
  }

  // Re-fetch transactions whenever from/to/accountPath change.
  $effect(() => {
    loading = true
    fetchTransactions({ from, to, accountPath: accountPath || undefined }).then(
      (txs) => {
        transactions = txs
        loading = false
      },
    )
  })

  let sortedTransactions = $derived(
    [...transactions].sort((a, b) => {
      const cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0
      return sortDir === 'desc' ? -cmp : cmp
    }),
  )

  function navigate(params: Record<string, string>) {
    const base: Record<string, string> = { from, to, dir: sortDir }
    if (accountPath) base.accountPath = accountPath
    goto(`?${new URLSearchParams({ ...base, ...params })}`)
  }

  function handleApply(newFrom: string, newTo: string) {
    navigate({ from: newFrom, to: newTo })
  }

  function handleSortChange(dir: 'asc' | 'desc') {
    navigate({ dir })
  }

  function handleAccountPathChange(path: string) {
    const base: Record<string, string> = { from, to, dir: sortDir }
    if (path) base.accountPath = path
    goto(`?${new URLSearchParams(base)}`)
  }

  // Accounts and settings don't depend on the date range — fetch once.
  onMount(async () => {
    const [accts, settings] = await Promise.all([
      fetchAccounts(),
      settingsStore.load(),
    ])
    accounts = accts
    defaultOffsetAccountId = settings.defaultOffsetAccountId
    defaultConversionAccountId = settings.defaultConversionAccountId
  })
</script>

<AddTransactionModal
  {accounts}
  {defaultOffsetAccountId}
  open={addModalOpen}
  onclose={() => (addModalOpen = false)}
  oncreated={(tx) => {
    const txDate = tx.date.substring(0, 10)
    if (txDate >= from && txDate <= to) transactions = [tx, ...transactions]
    refreshSidebar()
  }}
  onaccountcreated={(a) => (accounts = [...accounts, a])}
/>

<div class="page">
  <div class="toolbar">
    <div class="filter-wrap">
      <FilterPanel
        {from}
        {to}
        {sortDir}
        {accountPath}
        onApply={handleApply}
        onSortChange={handleSortChange}
        onAccountPathChange={handleAccountPathChange}
      />
    </div>
    <div class="toolbar-sep"></div>
    <div class="ops">
      {#if selectMode}
        <GradientButton
          variant="warning"
          active={selectedIds.size > 0}
          disabled={selectedIds.size === 0 || deleting}
          onclick={deleteSelected}
        >
          <Icon name="trash" /> Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
        </GradientButton>
        <GradientButton onclick={toggleSelectMode}>Cancel</GradientButton>
      {:else}
        <GradientButton onclick={() => (addModalOpen = true)}>
          <Icon name="plus" /> New
        </GradientButton>
        <GradientButton onclick={toggleSelectMode}>
          <Icon name="edit-txn" /> Select
        </GradientButton>
      {/if}
    </div>
  </div>

  <div class="section-bar">
    <span class="section-bar-title">
      Transactions · {sortedTransactions.length} entries
    </span>
  </div>

  <div class="tx-body" use:scrollShadow>
    {#if loading}
      {#each { length: 7 } as _}
        <TransactionRowSkeleton />
      {/each}
    {:else if sortedTransactions.length === 0}
      <p class="empty">No transactions in this period.</p>
    {:else}
      {#each sortedTransactions as tx (tx.id)}
        <TransactionRow
          {tx}
          {accounts}
          {defaultOffsetAccountId}
          {defaultConversionAccountId}
          selectable={selectMode}
          selected={selectedIds.has(tx.id)}
          ontoggleselect={toggleSelect}
          onaccountcreated={(a) => (accounts = [...accounts, a])}
          ondeleted={() =>
            (transactions = transactions.filter(
              (t: { id: string }) => t.id !== tx.id,
            ))}
        />
      {/each}
    {/if}
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
    flex-shrink: 0;
  }

  .filter-wrap {
    flex: 1;
    min-width: 0;
  }

  .toolbar-sep {
    width: 1px;
    background: var(--color-rule);
    margin: 6px 0;
    flex-shrink: 0;
  }

  .ops {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
  }

  .section-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: 6px 14px;
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
    flex-shrink: 0;
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
  }

  .tx-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: var(--color-window-raised);
  }

  .empty {
    padding: var(--sp-lg) 14px;
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-muted);
  }

  @media (max-width: 520px) {
    .toolbar {
      flex-wrap: wrap;
    }
  }
</style>
