<script lang="ts">
  import {
    fetchTransactions,
    fetchAccounts,
    deleteTransaction,
    type Account,
  } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import AddTransactionModal from '$lib/components/transactions/AddTransactionModal.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Panel from '$lib/components/ui/Panel.svelte'
  import { toISODate } from '$lib/date'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import FilterPanel from '$lib/components/transactions/FilterPanel.svelte'
  import TransactionRow from '$lib/components/transactions/TransactionRow.svelte'
  import TransactionRowSkeleton from '$lib/components/transactions/TransactionRowSkeleton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'

  // Default range: today minus 30 days → today
  // Computed once at module load; stable for the lifetime of the page.
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
  }}
  onaccountcreated={(a) => (accounts = [...accounts, a])}
/>

<div class="panels">
  <FilterPanel
    {from}
    {to}
    {sortDir}
    {accountPath}
    onApply={handleApply}
    onSortChange={handleSortChange}
    onAccountPathChange={handleAccountPathChange}
  />
  <Panel title="Operations">
    <div class="ops-body">
      {#if selectMode}
        <Button
          variant="danger"
          disabled={selectedIds.size === 0 || deleting}
          onclick={deleteSelected}
          ><Icon name="trash" /> Delete{selectedIds.size > 0
            ? ` (${selectedIds.size})`
            : ''}</Button
        >
        <Button onclick={toggleSelectMode}>Cancel</Button>
      {:else}
        <Button onclick={() => (addModalOpen = true)}
          ><Icon name="plus" /> New</Button
        >
        <a href="/import" class="btn-link"
          ><Button><Icon name="import" /> Import</Button></a
        >
        <Button disabled tooltip="Coming soon"
          ><Icon name="export" /> Export</Button
        >
        <Button onclick={toggleSelectMode}
          ><Icon name="edit-txn" /> Select</Button
        >
      {/if}
    </div>
  </Panel>
</div>

{#if loading}
  <div class="tx-table">
    {#each { length: 7 } as _}
      <TransactionRowSkeleton />
    {/each}
  </div>
{:else if sortedTransactions.length === 0}
  <p class="empty">No transactions 🕵️</p>
{:else}
  <div class="tx-table">
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
  </div>
{/if}

<style>
  .panels {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    margin-bottom: var(--sp-xl);
  }

  .panels :global(.panel) {
    margin-bottom: 0;
  }

  .ops-body {
    display: flex;
    flex-direction: row;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
  }

  .btn-link {
    text-decoration: none;
    display: contents;
  }

  .tx-table {
    box-shadow: var(--shadow-sunken);
    background: var(--color-window-raised);
  }

  .empty {
    box-shadow: var(--shadow-sunken);
    background: var(--color-window-raised);
    padding: var(--sp-md);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin: 0;
  }
</style>
