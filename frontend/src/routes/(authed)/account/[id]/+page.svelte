<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import {
    fetchAccount,
    fetchAccountBalances,
    fetchAccounts,
    fetchTransactions,
    fetchActionRequired,
    type Account,
  } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import { actionRequiredStore } from '$lib/actionRequired.svelte'
  import AccountHeading from '$lib/components/accounts/AccountHeading.svelte'
  import { toISODate } from '$lib/date'
  import FilterPanel from '$lib/components/transactions/FilterPanel.svelte'
  import AddTransactionModal from '$lib/components/transactions/AddTransactionModal.svelte'
  import AccountTransactionRow from '$lib/components/transactions/AccountTransactionRow.svelte'
  import AccountTransactionRowSkeleton from '$lib/components/transactions/AccountTransactionRowSkeleton.svelte'
  import Panel from '$lib/components/ui/Panel.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import AccountSettings from '$lib/components/accounts/AccountSettings.svelte'
  import ReconcileModal from '$lib/components/accounts/ReconcileModal.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'

  let id = $derived(page.params.id!)

  // Default range: last 30 days, computed once.
  function defaultRange() {
    const today = new Date()
    const from = new Date(today)
    from.setMonth(today.getMonth() - 3)
    return { from: toISODate(from), to: toISODate(today) }
  }
  const defaults = defaultRange()

  let from = $derived(page.url.searchParams.get('from') ?? defaults.from)
  let to = $derived(page.url.searchParams.get('to') ?? defaults.to)
  let sortDir = $derived(
    (page.url.searchParams.get('dir') ?? 'desc') as 'asc' | 'desc',
  )

  let account = $state<Account | null>(null)
  let transactions = $state<Awaited<ReturnType<typeof fetchTransactions>>>([])
  let accounts = $state<Account[]>([])
  let accountBalances = $state<{ currency: string; amount: string }[]>([])
  let defaultOffsetAccountId = $state<string | null>(null)
  let defaultConversionAccountId = $state<string | null>(null)
  let preferredCurrency = $state('CAD')
  let loading = $state(true)
  let notFound = $state(false)
  let addModalOpen = $state(false)
  let settingsOpen = $state(false)
  let reconcileOpen = $state(false)

  // Action-required filter state
  let actionRequiredIds = $state<string[] | null>(null)
  let actionRequiredActive = $state(false)
  let actionRequiredCount = $derived(actionRequiredStore.getCount(id))

  // Reset filter state when navigating to a different account
  $effect(() => {
    void id
    actionRequiredIds = null
    actionRequiredActive = false
  })

  $effect(() => {
    let cancelled = false
    loading = true
    notFound = false
    Promise.all([
      fetchAccount(id),
      fetchTransactions({ accountId: id, from, to }),
      fetchAccountBalances(),
    ])
      .then(([acct, txs, allBalances]) => {
        if (cancelled) return
        account = acct
        transactions = txs
        accountBalances = allBalances.find((b) => b.id === id)?.balances ?? []
        loading = false
      })
      .catch(() => {
        if (cancelled) return
        notFound = true
        loading = false
      })
    return () => {
      cancelled = true
    }
  })

  onMount(async () => {
    const [accts, settings] = await Promise.all([
      fetchAccounts(),
      settingsStore.load(),
    ])
    accounts = accts
    defaultOffsetAccountId = settings.defaultOffsetAccountId
    defaultConversionAccountId = settings.defaultConversionAccountId
    preferredCurrency = settings.preferredCurrency ?? 'CAD'
  })

  let isHidden = $derived(
    settingsStore.value?.preferences.hiddenAccountIds?.includes(id) ?? false,
  )

  async function toggleHidden() {
    const s = settingsStore.value
    if (!s) return
    const current = s.preferences.hiddenAccountIds ?? []
    const next = isHidden ? current.filter((x) => x !== id) : [...current, id]
    await settingsStore.update({
      preferences: { ...s.preferences, hiddenAccountIds: next },
    })
  }

  let sortedTransactions = $derived(
    [...transactions].sort((a, b) => {
      const cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0
      return sortDir === 'desc' ? -cmp : cmp
    }),
  )

  let displayedTransactions = $derived(
    actionRequiredActive && actionRequiredIds !== null
      ? sortedTransactions.filter((tx) => actionRequiredIds!.includes(tx.id))
      : sortedTransactions,
  )

  async function toggleActionRequired() {
    if (actionRequiredIds === null) {
      const result = await fetchActionRequired(id)
      actionRequiredIds = result.transactionIds
    }
    actionRequiredActive = !actionRequiredActive
  }

  function navigate(params: Record<string, string>) {
    goto(`?${new URLSearchParams({ from, to, dir: sortDir, ...params })}`)
  }
</script>

{#if account}
  <ReconcileModal
    accountId={account.id}
    accountPath={account.path}
    bind:open={reconcileOpen}
    onSuccess={async () => {
      const allBalances = await fetchAccountBalances()
      accountBalances = allBalances.find((b) => b.id === id)?.balances ?? []
    }}
  />
{/if}

<AddTransactionModal
  {accounts}
  {defaultOffsetAccountId}
  {preferredCurrency}
  open={addModalOpen}
  onclose={() => (addModalOpen = false)}
  oncreated={(tx) => {
    const txDate = tx.date.substring(0, 10)
    if (txDate >= from && txDate <= to) transactions = [tx, ...transactions]
  }}
  onaccountcreated={(a) => (accounts = [...accounts, a])}
/>

{#if account}
  <AccountHeading {account} balances={accountBalances} />
{:else}
  <div class="account-header-placeholder"></div>
{/if}

<div class="panels">
  <FilterPanel
    {from}
    {to}
    {sortDir}
    {actionRequiredCount}
    {actionRequiredActive}
    onApply={(f, t) => navigate({ from: f, to: t })}
    onSortChange={(dir) => navigate({ dir })}
    onActionRequiredToggle={toggleActionRequired}
  />
  <Panel title="Operations">
    <div class="ops-body">
      <Button onclick={() => (addModalOpen = true)}>
        <Icon name="plus" />
        New
      </Button>
      <Button
        square
        onclick={() => (reconcileOpen = true)}
        tooltip="Reconcile account"
      >
        <Icon name="reconcile" />
      </Button>
      <Button
        square
        onclick={() => (settingsOpen = !settingsOpen)}
        tooltip="Account settings"
      >
        <Icon name="account-settings" />
      </Button>
    </div>
  </Panel>
</div>

{#if settingsOpen && account}
  <AccountSettings
    {account}
    hidden={isHidden}
    onupdated={(a) => (account = a)}
    ontogglehidden={toggleHidden}
  />
{/if}

{#if loading}
  <div class="tx-table">
    <div class="tx-header">
      <span>Date</span>
      <span>Description</span>
      <span class="col-account">Account</span>
      <span class="col-amount">Amount</span>
    </div>
    {#each { length: 7 } as _}
      <AccountTransactionRowSkeleton />
    {/each}
  </div>
{:else if notFound}
  <p class="empty">Account not found.</p>
{:else if displayedTransactions.length === 0}
  <p class="empty">{actionRequiredActive ? 'No flagged transactions in this period.' : 'No transactions in this period.'}</p>
{:else}
  <div class="tx-table">
    <div class="tx-header">
      <span>Date</span>
      <span>Description</span>
      <span class="col-account">Account</span>
      <span class="col-amount">Amount</span>
    </div>
    {#each displayedTransactions as tx (tx.id)}
      <AccountTransactionRow
        {tx}
        {accounts}
        {defaultOffsetAccountId}
        {defaultConversionAccountId}
        currentAccountId={id}
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
  .account-header-placeholder {
    height: calc(
      var(--text-3xl) * var(--leading-tight) + var(--sp-xl) * 2 + var(--sp-lg)
    );
  }

  .panels {
    display: flex;
    gap: var(--sp-sm);
    align-items: flex-start;
    margin-bottom: var(--sp-xl);
  }

  @media (max-width: 520px) {
    .panels {
      flex-direction: column;
    }

    .panels :global(.panel) {
      width: 100%;
    }
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
    /* 4 named columns only — actions lives outside this template in each row */
    --tx-cols: 5.5rem 1fr 1.5fr 8rem;
    box-shadow: var(--shadow-sunken);
    background: var(--color-window-raised);
  }

  .tx-header {
    display: grid;
    grid-template-columns: var(--tx-cols);
    align-items: center;
    gap: var(--sp-xs);
    padding: 3px var(--sp-sm);
    background: var(--color-window);
    border-bottom: 2px solid var(--color-bevel-dark);
    box-shadow: inset 0 -1px 0 var(--color-bevel-light);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    user-select: none;
  }

  .tx-header .col-amount {
    text-align: right;
  }

  @media (max-width: 520px) {
    .tx-table {
      --tx-cols: auto 1fr auto;
    }

    .tx-header .col-account {
      display: none;
    }
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
