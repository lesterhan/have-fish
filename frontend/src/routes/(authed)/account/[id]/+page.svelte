<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import {
    fetchAccount,
    fetchAccountBalances,
    fetchAccountCoverage,
    fetchAccounts,
    fetchTransactions,
    fetchActionRequired,
    fetchFxRate,
    fetchMalformedFxSpends,
    type Account,
    type AccountCoverage,
    type MalformedFxSpend,
    type Transaction,
  } from '$lib/api'
  import RepairFxSpendModal from '$lib/components/transactions/RepairFxSpendModal.svelte'
  import TransactionDetailModal from '$lib/components/transactions/TransactionDetailModal.svelte'
  import QuickEntryPanel from '$lib/components/accounts/QuickEntryPanel.svelte'
  import { settingsStore } from '$lib/settings.svelte'
  import { actionRequiredStore } from '$lib/actionRequired.svelte'
  import AccountHeading from '$lib/components/accounts/AccountHeading.svelte'
  import { toISODate } from '$lib/date'
  import FilterPanel from '$lib/components/transactions/FilterPanel.svelte'
  import AddTransactionModal from '$lib/components/transactions/AddTransactionModal.svelte'
  import AccountTransactionRow from '$lib/components/transactions/AccountTransactionRow.svelte'
  import AccountTransactionRowSkeleton from '$lib/components/transactions/AccountTransactionRowSkeleton.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountSettingsModal from '$lib/components/accounts/AccountSettingsModal.svelte'
  import ReconcileModal from '$lib/components/accounts/ReconcileModal.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import MoreMenu from '$lib/components/ui/MoreMenu.svelte'
  import { rangeSummary } from '$lib/components/transactions/rangeSummary'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import CoverageStrip from '$lib/components/catch-up/CoverageStrip.svelte'
  import { statusLine } from '$lib/components/catch-up/statusLine'
  import { attentionChip } from '$lib/components/transactions/attentionChip'
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
  let quickEntryOpen = $state(false)
  // The 90-day picture is one click away; the sentence is what sits on the page.
  let coverageOpen = $state(false)
  // The single transaction-detail surface: a row click selects a tx, opening the modal where
  // viewing, in-place edit, and deletion all happen.
  let selectedTx = $state<Transaction | null>(null)

  function applyEdit(updated: Transaction) {
    transactions = transactions.map((t) => (t.id === updated.id ? updated : t))
    selectedTx = updated
  }

  function applyDelete(deletedId: string) {
    transactions = transactions.filter((t) => t.id !== deletedId)
    selectedTx = null
  }

  // Action-required filter state
  let actionRequiredIds = $state<string[] | null>(null)
  let actionRequiredActive = $state(false)
  let actionRequiredCount = $derived(actionRequiredStore.getCount(id))
  let chip = $derived(attentionChip(actionRequiredCount))

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

  // Malformed cross-currency spends touching this account — drive the per-row Repair strip
  // and the repair modal. Fetched once per account.
  let malformedCandidates = $state<MalformedFxSpend[]>([])
  let conversionAccountConfigured = $state(true)
  let repairOpen = $state(false)
  let malformedIds = $derived(new Set(malformedCandidates.map((c) => c.transactionId)))

  async function loadMalformed() {
    try {
      const res = await fetchMalformedFxSpends()
      conversionAccountConfigured = res.conversionAccountConfigured
      // Keep only candidates that touch this account (by any posting).
      malformedCandidates = res.candidates.filter((c) =>
        c.before.some((p) => p.accountId === id),
      )
    } catch {
      malformedCandidates = []
    }
  }

  function handleHealed(transactionId: string) {
    malformedCandidates = malformedCandidates.filter((c) => c.transactionId !== transactionId)
    if (malformedCandidates.length === 0) repairOpen = false
    // Pull the corrected postings into the visible list + refresh the attention indicators.
    fetchTransactions({ accountId: id, from, to }).then((txs) => (transactions = txs))
    actionRequiredStore.invalidate()
    actionRequiredStore.load()
  }

  // Reset filter state when navigating to a different account
  $effect(() => {
    void id
    actionRequiredIds = null
    actionRequiredActive = false
    convertFx = false
    fxRateMap = new Map()
    quickEntryOpen = false
    loadMalformed()
  })

  let coverage = $state<AccountCoverage | null>(null)

  // Only the accounts the coach tracks have a coverage story to tell. An expense account is
  // derived from postings rather than imported, so a strip over it would be meaningless.
  let tracksCoverage = $derived(
    account?.resolvedType === 'asset' ||
      account?.resolvedType === 'cash' ||
      account?.resolvedType === 'liability',
  )

  // Also called by the settings modal after a catch-up config write: the horizon moves, so
  // the strip and the status line are stale until this runs again.
  async function refreshCoverage() {
    if (!tracksCoverage) {
      coverage = null
      return
    }
    // Failure here leaves the strip hidden rather than breaking the page — coverage is
    // context, not the reason the user opened this account.
    try {
      coverage = await fetchAccountCoverage(id)
    } catch {
      coverage = null
    }
  }

  $effect(() => {
    if (!tracksCoverage) {
      coverage = null
      return
    }
    let cancelled = false
    fetchAccountCoverage(id)
      .then((c) => {
        if (!cancelled) coverage = c
      })
      .catch(() => {
        if (!cancelled) coverage = null
      })
    return () => {
      cancelled = true
    }
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
  <AccountSettingsModal
    bind:open={settingsOpen}
    {account}
    hidden={isHidden}
    {preferredCurrency}
    {coverage}
    onupdated={(a) => (account = a)}
    ontogglehidden={toggleHidden}
    oncoveragechanged={refreshCoverage}
  />

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

<RepairFxSpendModal
  bind:open={repairOpen}
  candidates={malformedCandidates}
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

<div class="page" class:two-col={quickEntryOpen}>
  <div class="left-col">
    {#if account}
      <AccountHeading {account} balances={accountBalances} />
    {:else}
      <div class="header-placeholder"></div>
    {/if}

    {#if coverage}
      {@const status = statusLine(coverage)}
      <div class="status-line">
        <div class="status-strip">
          <CoverageStrip
            from={coverage.window.from}
            to={coverage.window.to}
            intervals={coverage.intervals}
            horizon={coverage.horizon}
            txnDates={coverage.txnDates}
            compact
          />
        </div>
        <span class="status-text">{status.text}</span>
        <button
          class="status-toggle"
          aria-expanded={coverageOpen}
          onclick={() => (coverageOpen = !coverageOpen)}
        >
          Coverage
          <span class="status-chevron" class:open={coverageOpen}>
            <Icon name="chevron-down-line" size={9} />
          </span>
        </button>

        {#if chip.show}
          <button
            class="attention-chip"
            class:on={actionRequiredActive}
            aria-pressed={actionRequiredActive}
            onclick={toggleActionRequired}
          >
            <Icon name="warning" size={11} />
            {chip.label}
          </button>
        {/if}
      </div>

      {#if coverageOpen}
        <div class="coverage-expanded">
          <div class="coverage-expanded-title">
            COVERAGE · LAST {coverage.window.days} DAYS
          </div>
          <CoverageStrip
            from={coverage.window.from}
            to={coverage.window.to}
            intervals={coverage.intervals}
            horizon={coverage.horizon}
            txnDates={coverage.txnDates}
          />
        </div>
      {/if}
    {/if}

    <div class="toolbar">
      <!-- Left: what you are LOOKING AT. Right: what you can DO. Two groups that mean
           different things can carry priority; one undifferentiated row cannot. -->
      <div class="tool-group">
        <FilterPanel
          {from}
          {to}
          {sortDir}
          defaultRange={defaults}
          quiet
          onApply={(f, t) => navigate({ from: f, to: t })}
          onSortChange={(dir) => navigate({ dir })}
        />
        <span class="range-summary">
          {rangeSummary(from, to, displayedTransactions.length)}
        </span>
        <GradientButton
          active={convertFx}
          onclick={() => (convertFx = !convertFx)}
          tooltip="Convert to {preferredCurrency}"
        >
          <CurrencyPill code={preferredCurrency} size="xs" />
        </GradientButton>
      </div>

      <span class="toolbar-spacer"></span>

      <div class="tool-group">
        <GradientButton
          active={quickEntryOpen}
          onclick={() => (quickEntryOpen = !quickEntryOpen)}
          tooltip="Quick Entry"
        >
          Quick Entry
        </GradientButton>
        <GradientButton
          variant="primary"
          onclick={() => (addModalOpen = true)}
          tooltip="New transaction"
        >
          <Icon name="plus" size={11} />
          New
        </GradientButton>
        <MoreMenu
          items={[
            { label: 'Reconcile', icon: 'reconcile', onselect: () => (reconcileOpen = true) },
            {
              label: 'Account settings',
              icon: 'account-settings',
              onselect: () => (settingsOpen = true),
            },
          ]}
        />
      </div>
    </div>

    <div class="tx-col-header">
      <span>DATE</span>
      <span>DESCRIPTION</span>
      <span class="col-account">ACCOUNT</span>
      <span class="col-amount">AMOUNT</span>
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
          {#if malformedIds.has(tx.id)}
            <button class="repair-strip" onclick={() => (repairOpen = true)}>
              <span class="repair-strip-icon">⚠</span>
              <span>Imported incorrectly — cross-currency spend needs repair.</span>
              <span class="repair-strip-cta">Repair</span>
            </button>
          {/if}
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
            onselect={(t) => (selectedTx = t)}
          />
        {/each}
      {/if}
    </div>
  </div>

  {#if quickEntryOpen && account}
    <div class="right-col">
      <QuickEntryPanel
        {account}
        {accounts}
        {defaultOffsetAccountId}
        {preferredCurrency}
        onaccountcreated={(a) => (accounts = [...accounts, a])}
        onaccountupdated={(a) => (account = a)}
        onsuccess={async () => {
          quickEntryOpen = false
          const txs = await fetchTransactions({ accountId: id, from, to })
          transactions = txs
          const allBalances = await fetchAccountBalances()
          accountBalances = allBalances.find((b) => b.id === id)?.balances ?? []
        }}
        onclose={() => (quickEntryOpen = false)}
      />
    </div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: row;
    height: 100%;
    overflow: hidden;
  }

  .repair-strip {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    width: 100%;
    text-align: left;
    padding: var(--sp-xs) var(--sp-md);
    background: var(--color-warning-light);
    color: var(--color-warning);
    border: none;
    border-left: 3px solid var(--color-warning);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: filter var(--duration-fast) var(--ease);
  }

  .repair-strip:hover {
    filter: brightness(0.97);
  }

  .repair-strip-cta {
    margin-left: auto;
    font-weight: var(--weight-semibold);
    text-decoration: underline;
  }

  .left-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .right-col {
    width: 400px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header-placeholder {
    height: 61px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
  }

  /* Toolbar: "looking at" on the left, "can do" on the right. */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
    flex-shrink: 0;
  }

  .tool-group {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    min-width: 0;
  }

  .toolbar-spacer {
    flex: 1;
    min-width: var(--sp-md);
  }

  /* Which days are on screen, spelled out — the date field shows a preset name. */
  .range-summary {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.3px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Column header, carrying the dark-bar weight now that the separate
     "Transactions · N entries" bar is gone — the count moved into the toolbar, next to
     the filter that produces it, and two bands became one. */
  .tx-col-header {
    --tx-cols: 5.5rem 1fr 1.5fr 8rem;
    display: grid;
    grid-template-columns: var(--tx-cols);
    align-items: center;
    gap: var(--sp-xs);
    padding: 6px 14px;
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
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
      flex-direction: column;
    }

    .right-col {
      width: 100%;
      height: 60vh;
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

    /* A flex:1 spacer between two wrapped groups would push the second group onto its
       own line and leave a gap; let the groups sit together and wrap on their own. */
    .toolbar-spacer {
      display: none;
    }
  }

  /* Coverage as a flat full-bleed band, like every other region on the page. The old
     Card gave it a floating object's corners and shadow while stretching edge to edge,
     and brought a second dark section bar that competed with the Transactions bar. */
  .status-line {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: 0 var(--sp-lg);
    height: 32px;
    background: var(--color-window-raised);
    border-bottom: 1px solid var(--color-rule);
    flex-shrink: 0;
  }

  .status-strip {
    width: 240px;
    flex-shrink: 0;
  }

  .status-text {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-right: auto;
  }

  .status-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: color var(--duration-fast) var(--ease);
  }

  .status-toggle:hover {
    color: var(--color-text);
  }

  .status-toggle:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .status-chevron {
    display: inline-flex;
    transform-origin: center center;
    transition: transform var(--duration-fast) var(--ease);
  }

  .status-chevron.open {
    transform: rotate(180deg);
  }

  /* The page's one amber region. No resting pulse: an infinite halo is a lot on a page you
     sit and read, and the amber fill carries the signal on its own. */
  .attention-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-xs);
    height: 20px;
    padding: 0 var(--sp-sm);
    border: 1px solid color-mix(in srgb, var(--color-warning) 70%, black);
    border-radius: var(--radius-pill);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-warning) 85%, white),
      var(--color-warning)
    );
    box-shadow: var(--shadow-control);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: color-mix(in srgb, var(--color-warning) 30%, black);
    white-space: nowrap;
    flex-shrink: 0;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .attention-chip:hover {
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-warning) 95%, white),
      color-mix(in srgb, var(--color-warning) 88%, white)
    );
  }

  /* Engaged = the list is filtered down to those transactions. */
  .attention-chip.on {
    box-shadow: var(--shadow-inset);
    background: linear-gradient(
      180deg,
      var(--color-warning),
      color-mix(in srgb, var(--color-warning) 80%, black)
    );
  }

  .attention-chip:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 1px;
  }

  .coverage-expanded {
    padding: var(--sp-sm) var(--sp-lg) var(--sp-md);
    background: var(--color-window-raised);
    border-bottom: 1px solid var(--color-rule);
    flex-shrink: 0;
  }

  .coverage-expanded-title {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: var(--color-text-muted);
    margin-bottom: var(--sp-xs);
  }

  @media (max-width: 520px) {
    .status-line {
      height: auto;
      flex-wrap: wrap;
      gap: var(--sp-xs);
      padding: var(--sp-xs) var(--sp-md);
    }

    .status-strip {
      width: 100%;
      order: 3;
    }
  }

</style>
