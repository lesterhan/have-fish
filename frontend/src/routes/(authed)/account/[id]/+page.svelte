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
    fetchFxRate,
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
  import Button from '$lib/components/ui/Button.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountSettings from '$lib/components/accounts/AccountSettings.svelte'
  import ReconcileModal from '$lib/components/accounts/ReconcileModal.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import { currencyFlag } from '$lib/currency'
  import { scrollShadow } from '$lib/scrollShadow'

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

  // FX convert toggle
  let convertFx = $state(false)
  // Cache: key = "${date}::${currency}", value = rate string or null (unavailable)
  let fxRateMap = $state(new Map<string, string | null>())

  // Whenever the toggle is on, ensure all unique (date, currency) pairs in the
  // displayed set have been fetched into the cache. New pairs are fetched lazily
  // on demand; already-cached keys (including null = unavailable) are skipped.
  $effect(() => {
    if (!convertFx) return
    const txs = displayedTransactions
    const pref = preferredCurrency
    void fetchMissingRates(txs, pref)
  })

  async function fetchMissingRates(
    txs: Awaited<ReturnType<typeof fetchTransactions>>,
    pref: string,
  ) {
    const pairs: { key: string; date: string; currency: string }[] = []
    for (const tx of txs) {
      const date = tx.date.substring(0, 10)
      for (const p of tx.postings) {
        if (p.currency !== pref) {
          const key = `${date}::${p.currency}`
          if (!fxRateMap.has(key))
            pairs.push({ key, date, currency: p.currency })
        }
      }
    }
    // De-dupe by key
    const unique = [...new Map(pairs.map((p) => [p.key, p])).values()]
    if (unique.length === 0) return

    const results = await Promise.all(
      unique.map(async ({ key, date, currency }) => {
        const result = await fetchFxRate(date, currency, pref)
        return [key, result?.rate ?? null] as [string, string | null]
      }),
    )
    fxRateMap = new Map([...fxRateMap, ...results])
  }

  // Reset filter state when navigating to a different account
  $effect(() => {
    void id
    actionRequiredIds = null
    actionRequiredActive = false
    convertFx = false
    fxRateMap = new Map()
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

<div class="page">
  {#if account}
    <AccountHeading {account} balances={accountBalances} />
  {:else}
    <div class="header-placeholder"></div>
  {/if}

  <div class="toolbar">
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
    <div class="toolbar-sep"></div>
    <div class="ops">
      <GradientButton onclick={() => (addModalOpen = true)}>
        <Icon name="plus" /> New
      </GradientButton>
      <GradientButton square onclick={() => (reconcileOpen = true)} tooltip="Reconcile account">
        <Icon name="reconcile" />
      </GradientButton>
      <GradientButton square onclick={() => (settingsOpen = !settingsOpen)} tooltip="Account settings">
        <Icon name="account-settings" />
      </GradientButton>
      <GradientButton active={convertFx} onclick={() => (convertFx = !convertFx)} tooltip="Convert to {preferredCurrency}">
        <CurrencyPill code={preferredCurrency} size="xs" />
      </GradientButton>
    </div>
  </div>

  {#if settingsOpen && account}
    <AccountSettings
      {account}
      hidden={isHidden}
      onupdated={(a) => (account = a)}
      ontogglehidden={toggleHidden}
    />
  {/if}

  <div class="section-bar">
    <span class="section-bar-title">
      Transactions · {displayedTransactions.length} entries
    </span>
  </div>

  <div class="tx-col-header">
    <span>DATE</span>
    <span>DESCRIPTION</span>
    <span class="col-account">ACCOUNT</span>
    <span class="col-amount">AMOUNT</span>
    <span></span>
  </div>

  <div class="tx-body" use:scrollShadow>
    {#if loading}
      {#each { length: 7 } as _}
        <AccountTransactionRowSkeleton />
      {/each}
    {:else if notFound}
      <p class="empty">Account not found.</p>
    {:else if displayedTransactions.length === 0}
      <p class="empty">
        {actionRequiredActive
          ? 'No flagged transactions in this period.'
          : 'No transactions in this period.'}
      </p>
    {:else}
      {#each displayedTransactions as tx, i (tx.id)}
        <AccountTransactionRow
          {tx}
          idx={i}
          {accounts}
          {defaultOffsetAccountId}
          {defaultConversionAccountId}
          currentAccountId={id}
          {convertFx}
          {preferredCurrency}
          {fxRateMap}
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
    margin: calc(-1 * var(--sp-lg));
    height: calc(100% + 2 * var(--sp-lg));
    overflow: hidden;
  }

  .header-placeholder {
    height: 61px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
  }

  /* Toolbar: FilterPanel (bare) + divider + ops buttons */
  .toolbar {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
    flex-shrink: 0;
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

  /* Section bar */
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

  /* Column header */
  .tx-col-header {
    --tx-cols: 5.5rem 1fr 1.5fr 8rem;
    display: grid;
    grid-template-columns: var(--tx-cols) auto;
    align-items: center;
    gap: var(--sp-xs);
    padding: 4px 14px;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    user-select: none;
  }

  .tx-col-header .col-amount {
    text-align: right;
  }

  /* Scrollable body — passes --tx-cols to child rows */
  .tx-body {
    --tx-cols: 5.5rem 1fr 1.5fr 8rem;
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
    .page {
      margin: calc(-1 * var(--sp-md));
      height: calc(100% + 2 * var(--sp-md));
    }

    .tx-col-header,
    .tx-body {
      --tx-cols: auto 1fr auto;
    }

    .tx-col-header .col-account {
      display: none;
    }

    .toolbar {
      flex-wrap: wrap;
    }
  }
</style>
