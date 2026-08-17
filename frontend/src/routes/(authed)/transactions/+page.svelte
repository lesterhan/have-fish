<script lang="ts">
  import {
    fetchTransactions,
    deleteTransaction,
    fetchMalformedFxSpends,
    type Account,
    type MalformedFxSpend,
    type Transaction,
  } from '$lib/api'
  import type { PageData } from './$types'
  import RepairFxSpendModal from '$lib/components/transactions/RepairFxSpendModal.svelte'
  import TransactionDetailModal from '$lib/components/transactions/TransactionDetailModal.svelte'
  import { bump as refreshSidebar } from '$lib/sidebarRefresh.svelte'
  import { settingsStore } from '$lib/settings.svelte'
  import AddTransactionModal from '$lib/components/transactions/AddTransactionModal.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import { page, navigating } from '$app/state'
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { onMount, untrack } from 'svelte'
  import FilterPanel from '$lib/components/transactions/FilterPanel.svelte'
  import TransactionRow from '$lib/components/transactions/TransactionRow.svelte'
  import TransactionRowSkeleton from '$lib/components/transactions/TransactionRowSkeleton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { scrollShadow } from '$lib/scrollShadow'

  let { data }: { data: PageData } = $props()

  // Seed the shared settings store with what the server load already fetched, during component
  // init rather than in onMount: effects flush child-first, so by onMount the layout has
  // already fired its own /api/user-settings request. Doing it here beats that to the punch.
  // Browser-only — this store's state is module-level, and on the server that module is shared
  // across every request.
  if (browser) settingsStore.prime(untrack(() => data.settings))

  // The server load resolved the effective range (URL params, else the 90-day default in the
  // viewer's timezone) and fetched against it, so these mirror what the payload actually is.
  let from = $derived(data.from)
  let to = $derived(data.to)
  let sortDir = $derived(
    (page.url.searchParams.get('dir') ?? 'desc') as 'asc' | 'desc',
  )
  let accountPath = $derived(page.url.searchParams.get('accountPath') ?? '')

  // Local copies of the loaded data: creating, editing and deleting update the list in place
  // without a refetch, so these can't be plain $derived. The $effect re-seeds them whenever a
  // navigation (a filter change) delivers a fresh server load.
  let transactions = $state<Transaction[]>(untrack(() => data.transactions))
  let accounts = $state<Account[]>(untrack(() => data.accounts))
  $effect(() => {
    transactions = data.transactions
  })
  $effect(() => {
    accounts = data.accounts
  })

  let defaultOffsetAccountId = $derived(data.settings.defaultOffsetAccountId)
  let defaultConversionAccountId = $derived(data.settings.defaultConversionAccountId)
  // Filter changes navigate, so the skeleton tracks the navigation rather than a fetch flag.
  let loading = $derived(
    navigating.to !== null && navigating.to.route.id === page.route.id,
  )
  let addModalOpen = $state(false)
  let repairModalOpen = $state(false)
  let malformed = $state<MalformedFxSpend[]>([])
  let conversionAccountConfigured = $state(true)
  let selectMode = $state(false)
  let selectedIds = $state(new Set<string>())
  let deleting = $state(false)
  // The single transaction-detail surface: a row click selects a tx, opening the modal where
  // viewing, in-place edit, and deletion all happen.
  let selectedTx = $state<Transaction | null>(null)

  // Reflect an in-place edit back into the list without a refetch.
  function applyEdit(updated: Transaction) {
    transactions = transactions.map((t) => (t.id === updated.id ? updated : t))
    selectedTx = updated
  }

  function applyDelete(id: string) {
    transactions = transactions.filter((t) => t.id !== id)
    selectedTx = null
    refreshSidebar()
  }

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

  // The repair scan is the one fetch left on the client — it's advisory, and walking the
  // user's whole multi-currency history has no business delaying the rows.
  onMount(loadMalformed)

  async function loadMalformed() {
    try {
      const res = await fetchMalformedFxSpends()
      malformed = res.candidates
      conversionAccountConfigured = res.conversionAccountConfigured
    } catch {
      // Non-critical surface — a load failure shouldn't break the page.
      malformed = []
    }
  }

  function handleHealed(transactionId: string) {
    malformed = malformed.filter((c) => c.transactionId !== transactionId)
    if (malformed.length === 0) repairModalOpen = false
    // Pull the corrected postings into the visible list.
    fetchTransactions({ from, to, accountPath: accountPath || undefined }).then(
      (txs) => (transactions = txs),
    )
    refreshSidebar()
  }
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

<RepairFxSpendModal
  bind:open={repairModalOpen}
  candidates={malformed}
  {conversionAccountConfigured}
  onhealed={handleHealed}
/>

<TransactionDetailModal
  tx={selectedTx}
  open={selectedTx !== null}
  onclose={() => (selectedTx = null)}
  {accounts}
  {defaultOffsetAccountId}
  onaccountcreated={(a) => (accounts = [...accounts, a])}
  onsaved={applyEdit}
  ondeleted={() => selectedTx && applyDelete(selectedTx.id)}
/>

<div class="page">
  {#if malformed.length > 0}
    <button class="repair-banner" onclick={() => (repairModalOpen = true)}>
      <span class="repair-icon">⚠</span>
      <span>
        {malformed.length}
        {malformed.length === 1 ? 'transaction needs' : 'transactions need'}
        repair — a cross-currency import booked the spend incorrectly.
      </span>
      <span class="repair-cta">Review</span>
    </button>
  {/if}
  <div class="toolbar">
    <div class="filter-wrap">
      <FilterPanel
        {from}
        {to}
        {sortDir}
        {accountPath}
        {accounts}
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
          onselect={(t) => (selectedTx = t)}
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

  .repair-banner {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    width: 100%;
    text-align: left;
    padding: var(--sp-xs) var(--sp-md);
    background: var(--color-warning-light);
    color: var(--color-warning);
    border: none;
    border-bottom: 1px solid var(--color-warning);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: filter var(--duration-fast) var(--ease);
  }

  .repair-banner:hover {
    filter: brightness(0.97);
  }

  .repair-icon {
    font-size: var(--text-base);
  }

  .repair-cta {
    margin-left: auto;
    font-weight: var(--weight-semibold);
    text-decoration: underline;
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
