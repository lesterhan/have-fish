<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { fetchAccount, fetchAccountBalances, fetchAccounts, fetchTransactions, type Account } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import AccountHeading from '$lib/components/AccountHeading.svelte'
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
  let accountBalances = $state<{ currency: string; amount: string }[]>([])
  let defaultOffsetAccountId     = $state<string | null>(null)
  let defaultConversionAccountId = $state<string | null>(null)
  let loading  = $state(true)
  let notFound = $state(false)
  let addModalOpen = $state(false)
  let settingsOpen = $state(false)

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
    const [accts, settings, allBalances] = await Promise.all([
      fetchAccounts(),
      settingsStore.load(),
      fetchAccountBalances(),
    ])
    accounts = accts
    defaultOffsetAccountId = settings.defaultOffsetAccountId
    defaultConversionAccountId = settings.defaultConversionAccountId
    const match = allBalances.find((b) => b.id === id)
    accountBalances = match?.balances ?? []
  })

  let isHidden = $derived(
    settingsStore.value?.preferences.hiddenAccountIds?.includes(id) ?? false
  )

  async function toggleHidden() {
    const s = settingsStore.value
    if (!s) return
    const current = s.preferences.hiddenAccountIds ?? []
    const next = isHidden ? current.filter((x) => x !== id) : [...current, id]
    await settingsStore.update({ preferences: { ...s.preferences, hiddenAccountIds: next } })
  }

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

{#if account}
  <AccountHeading {account} onupdated={(a) => (account = a)} hidden={isHidden} ontogglehidden={toggleHidden} balances={accountBalances} />
{:else}
  <div class="account-header-placeholder"></div>
{/if}

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
      <Button onclick={() => (settingsOpen = !settingsOpen)}>Settings ⚙️</Button>
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
  .account-header-placeholder {
    height: calc(var(--text-3xl) * var(--leading-tight) + var(--sp-xl) * 2 + var(--sp-lg));
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
