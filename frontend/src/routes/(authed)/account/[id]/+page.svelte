<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { fetchAccount, fetchAccounts, fetchTransactions, fetchUserSettings, type Account } from '$lib/api'
  import TransactionRow from '$lib/components/TransactionRow.svelte'
  import TransactionRowSkeleton from '$lib/components/TransactionRowSkeleton.svelte'

  let id = $derived(page.params.id!)

  let account = $state<Account | null>(null)
  let transactions = $state<Awaited<ReturnType<typeof fetchTransactions>>>([])
  let accounts = $state<Account[]>([])
  let defaultOffsetAccountId = $state<string | null>(null)
  let defaultConversionAccountId = $state<string | null>(null)
  let loading = $state(true)
  let notFound = $state(false)

  // Re-fetch whenever the id param changes (e.g. navigating between account pages).
  // The cancelled flag prevents a slow previous fetch from overwriting newer results.
  $effect(() => {
    let cancelled = false
    loading = true
    notFound = false
    Promise.all([
      fetchAccount(id),
      fetchTransactions({ accountId: id }),
    ]).then(([acct, txs]) => {
      if (cancelled) return
      account = acct
      // Newest first
      transactions = txs.sort((a: { date: string }, b: { date: string }) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0
      )
      loading = false
    }).catch(() => {
      if (cancelled) return
      notFound = true
      loading = false
    })
    return () => { cancelled = true }
  })

  // Accounts and settings don't depend on the id — fetch once.
  onMount(async () => {
    ;[accounts, { defaultOffsetAccountId, defaultConversionAccountId }] =
      await Promise.all([fetchAccounts(), fetchUserSettings()])
  })

  let heading = $derived(account?.name ?? account?.path ?? '…')
</script>

<header class="account-header">
  <h1 class="account-title">{heading}</h1>
  {#if account?.name && account.path}
    <p class="account-path">{account.path}</p>
  {/if}
</header>

{#if loading}
  <div class="tx-table">
    {#each { length: 7 } as _}
      <TransactionRowSkeleton />
    {/each}
  </div>
{:else if notFound}
  <p class="empty">Account not found.</p>
{:else if transactions.length === 0}
  <p class="empty">No transactions for this account yet.</p>
{:else}
  <div class="tx-table">
    {#each transactions as tx (tx.id)}
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
