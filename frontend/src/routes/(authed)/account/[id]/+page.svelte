<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { fetchAccount, fetchAccounts, fetchTransactions, fetchUserSettings, type Account } from '$lib/api'
  import { toISODate } from '$lib/date'
  import FilterPanel from '$lib/components/FilterPanel.svelte'
  import AddTransactionModal from '$lib/components/AddTransactionModal.svelte'
  import TransactionRow from '$lib/components/TransactionRow.svelte'
  import TransactionRowSkeleton from '$lib/components/TransactionRowSkeleton.svelte'
  import Panel from '$lib/components/ui/Panel.svelte'
  import Button from '$lib/components/ui/Button.svelte'

  let id = $derived(page.params.id!)

  // Default range: last 30 days, computed once.
  function defaultRange() {
    const today = new Date()
    const from = new Date(today)
    from.setDate(today.getDate() - 30)
    return { from: toISODate(from), to: toISODate(today) }
  }
  const defaults = defaultRange()

  let from    = $derived(page.url.searchParams.get('from') ?? defaults.from)
  let to      = $derived(page.url.searchParams.get('to')   ?? defaults.to)
  let sortDir = $derived((page.url.searchParams.get('dir') ?? 'desc') as 'asc' | 'desc')

  let account    = $state<Account | null>(null)
  let transactions = $state<Awaited<ReturnType<typeof fetchTransactions>>>([])
  let accounts   = $state<Account[]>([])
  let defaultOffsetAccountId     = $state<string | null>(null)
  let defaultConversionAccountId = $state<string | null>(null)
  let loading  = $state(true)
  let notFound = $state(false)
  let addModalOpen = $state(false)

  $effect(() => {
    let cancelled = false
    loading = true
    notFound = false
    Promise.all([
      fetchAccount(id),
      fetchTransactions({ accountId: id, from, to }),
    ]).then(([acct, txs]) => {
      if (cancelled) return
      account = acct
      transactions = txs
      loading = false
    }).catch(() => {
      if (cancelled) return
      notFound = true
      loading = false
    })
    return () => { cancelled = true }
  })

  onMount(async () => {
    ;[accounts, { defaultOffsetAccountId, defaultConversionAccountId }] =
      await Promise.all([fetchAccounts(), fetchUserSettings()])
  })

  let heading = $derived(account?.name ?? account?.path ?? '…')

  let sortedTransactions = $derived(
    [...transactions].sort((a, b) => {
      const cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0
      return sortDir === 'desc' ? -cmp : cmp
    })
  )

  function navigate(params: Record<string, string>) {
    goto(`?${new URLSearchParams({ from, to, dir: sortDir, ...params })}`)
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
  }}
  onaccountcreated={(a) => (accounts = [...accounts, a])}
/>

<header class="account-header">
  <h1 class="account-title">{heading}</h1>
  {#if account?.name && account.path}
    <p class="account-path">{account.path}</p>
  {/if}
</header>

<div class="panels">
  <FilterPanel
    {from}
    {to}
    {sortDir}
    onApply={(f, t) => navigate({ from: f, to: t })}
    onSortChange={(dir) => navigate({ dir })}
  />
  <Panel title="Operations">
    <div class="ops-body">
      <Button onclick={() => (addModalOpen = true)}>New ➕</Button>
    </div>
  </Panel>
</div>

{#if loading}
  <div class="tx-table">
    {#each { length: 7 } as _}
      <TransactionRowSkeleton />
    {/each}
  </div>
{:else if notFound}
  <p class="empty">Account not found.</p>
{:else if sortedTransactions.length === 0}
  <p class="empty">No transactions in this period.</p>
{:else}
  <div class="tx-table">
    {#each sortedTransactions as tx (tx.id)}
      <TransactionRow
        {tx}
        {accounts}
        {defaultOffsetAccountId}
        {defaultConversionAccountId}
        onaccountcreated={(a) => (accounts = [...accounts, a])}
        ondeleted={() => (transactions = transactions.filter((t: { id: string }) => t.id !== tx.id))}
      />
    {/each}
  </div>
{/if}

<style>
  .account-header {
    margin-bottom: var(--sp-lg);
  }

  .account-title {
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .account-path {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin-top: 2px;
  }

  .panels {
    display: flex;
    gap: var(--sp-sm);
    align-items: flex-start;
    margin-bottom: var(--sp-xl);
  }

  .panels :global(.panel:first-child) {
    flex: 1;
    margin-bottom: 0;
  }

  .panels :global(.panel:last-child) {
    margin-bottom: 0;
  }

  .ops-body {
    display: flex;
    flex-direction: row;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
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
