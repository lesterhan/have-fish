<script lang="ts">
  import { onMount } from 'svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Panel from '$lib/components/ui/Panel.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import SpendingChart from '$lib/components/spending/SpendingChart.svelte'
  import TransactionRow from '$lib/components/transactions/TransactionRow.svelte'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import {
    fetchSpendingSummary,
    fetchTransactions,
    fetchAccounts,
    fetchUserSettings,
    fetchSpendingFxPairs,
    fetchFxRate,
    fetchSpendingConverted,
    fetchMonthlySpend,
  } from '$lib/api'
  import type {
    SpendingSummary,
    Account,
    Transaction,
    MonthlySpend,
  } from '$lib/api'
  import { monthStart, monthEnd, shiftMonth, MONTH_NAMES } from '$lib/date'

  // --- Month state ---
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  let year = $state(prev.getFullYear())
  let month = $state(prev.getMonth() + 1)

  let summary = $state<SpendingSummary | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let currency = $state('CAD')
  let drillPath = $state<string | null>(null)

  let currencies = $derived(Object.keys(summary?.total ?? {}))
  let currencyEntries = $derived(Object.entries(summary?.total ?? {}))

  let preferredCurrency = $state('CAD')
  let accounts = $state<Account[]>([])
  let txns = $state<Transaction[]>([])
  let txnsLoading = $state(false)

  // --- FX conversion state ---
  let converting = $state(false)
  let fxFetching = $state(false)
  let fxRemaining = $state(0)
  let convertedTotal = $state<string | null>(null)
  let conversionUnavailable = $state(false)

  let needsConversion = $derived(
    currencyEntries.some(([c]) => c !== preferredCurrency),
  )


  // --- Monthly trend data ---
  let monthlyData = $state<MonthlySpend[]>([])

  let deltaLastMonth = $derived.by<Record<string, number> | null>(() => {
    if (!summary || monthlyData.length === 0) return null
    const key = `${year}-${String(month).padStart(2, '0')}`
    const idx = monthlyData.findIndex((m) => m.month === key)
    if (idx <= 0) return null
    const curr = monthlyData[idx].total
    const prev = monthlyData[idx - 1].total
    const result: Record<string, number> = {}
    for (const [c, amt] of Object.entries(curr)) {
      if (!prev[c]) continue
      const currAbs = Math.abs(parseFloat(amt))
      const prevAbs = Math.abs(parseFloat(prev[c]))
      if (prevAbs > 0) result[c] = ((currAbs - prevAbs) / prevAbs) * 100
    }
    return Object.keys(result).length > 0 ? result : null
  })

  let delta3moAvg = $derived.by<Record<string, number> | null>(() => {
    if (!summary || monthlyData.length === 0) return null
    const key = `${year}-${String(month).padStart(2, '0')}`
    const idx = monthlyData.findIndex((m) => m.month === key)
    if (idx < 3) return null
    const curr = monthlyData[idx].total
    const result: Record<string, number> = {}
    for (const [c, amt] of Object.entries(curr)) {
      const prior3 = monthlyData.slice(idx - 3, idx)
      const vals = prior3.map((m) => Math.abs(parseFloat(m.total[c] ?? '0')))
      const avg = vals.reduce((a, b) => a + b, 0) / 3
      if (avg > 0) {
        result[c] = ((Math.abs(parseFloat(amt)) - avg) / avg) * 100
      }
    }
    return Object.keys(result).length > 0 ? result : null
  })

  let isMultiCurrency = $derived(currencyEntries.length > 1)

  function formatDelta(pct: number): string {
    return `${pct > 0 ? '↑' : '↓'} ${Math.round(Math.abs(pct))}%`
  }

  function formatAmount(amount: string): string {
    const n = Math.abs(parseFloat(amount))
    return n.toLocaleString('en-CA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  async function startConversion() {
    fxFetching = true
    conversionUnavailable = false
    convertedTotal = null

    const from = monthStart(year, month)
    const to = monthEnd(year, month)

    const { pairs } = await fetchSpendingFxPairs(from, to, preferredCurrency)
    const missing = pairs.filter((p) => !p.cached)
    fxRemaining = missing.length

    if (missing.length > 0) {
      await Promise.all(
        missing.map(async (pair) => {
          await fetchFxRate(pair.date, pair.from, pair.to)
          fxRemaining -= 1
        }),
      )
    }

    const result = await fetchSpendingConverted(from, to, preferredCurrency)
    if (result.total !== null) {
      convertedTotal = result.total
    } else {
      conversionUnavailable = true
    }
    fxFetching = false
  }

  async function handleConvertToggle() {
    if (!converting) {
      converting = true
      await startConversion()
    } else {
      converting = false
      convertedTotal = null
      fxFetching = false
      fxRemaining = 0
      conversionUnavailable = false
    }
  }

  // Re-run conversion when month changes
  $effect(() => {
    year
    month
    convertedTotal = null
    conversionUnavailable = false
    if (converting) startConversion()
  })

  // --- Data loading ---
  let txnPanelTitle = $derived.by(() => {
    const label = drillPath
      ? drillPath.split(':').slice(1).join(':') || drillPath
      : null
    const count = txnsLoading ? '' : ` (${txns.length})`
    return label ? `Transactions — ${label}${count}` : `Transactions${count}`
  })

  type Crumb = { label: string; path: string | null; current: boolean }
  let breadcrumbs = $derived.by<Crumb[]>(() => {
    const root =
      drillPath?.split(':')[0] ??
      summary?.categories[0]?.category.split(':')[0] ??
      'expenses'
    const rootLabel = root.charAt(0).toUpperCase() + root.slice(1)

    if (!drillPath) return [{ label: rootLabel, path: null, current: true }]

    const segments = drillPath.split(':').slice(1)
    const crumbs: Crumb[] = [{ label: rootLabel, path: null, current: false }]
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      crumbs.push({
        label: seg.charAt(0).toUpperCase() + seg.slice(1),
        path: [root, ...segments.slice(0, i + 1)].join(':'),
        current: i === segments.length - 1,
      })
    }
    return crumbs
  })

  async function load() {
    loading = true
    error = null
    try {
      const result = await fetchSpendingSummary(
        monthStart(year, month),
        monthEnd(year, month),
        drillPath ?? undefined,
      )
      summary = result
      const available = Object.keys(result.total)
      if (available.length > 0 && !available.includes(currency)) {
        currency = available[0]
      }
    } catch {
      error = 'Failed to load spending data.'
    } finally {
      loading = false
    }
  }

  async function loadTxns() {
    txnsLoading = true
    const accountPath =
      drillPath ?? summary?.categories[0]?.category.split(':')[0] ?? 'expenses'
    try {
      txns = await fetchTransactions({
        from: monthStart(year, month),
        to: monthEnd(year, month),
        accountPath,
      })
    } catch {
      txns = []
    } finally {
      txnsLoading = false
    }
  }

  function navigate(delta: number) {
    const next = shiftMonth(year, month, delta)
    year = next.year
    month = next.month
    drillPath = null
    load().then(loadTxns)
  }

  function drill(category: string) {
    drillPath = category
    load()
    loadTxns()
  }

  function navigateTo(path: string | null) {
    drillPath = path
    load()
    loadTxns()
  }

  onMount(() => {
    fetchUserSettings().then((s) => {
      preferredCurrency = s.preferredCurrency ?? 'CAD'
    })
    fetchAccounts().then((a) => {
      accounts = a
    })
    fetchMonthlySpend(7).then((d) => {
      monthlyData = d
    })
    load().then(loadTxns)
  })
</script>

<div class="page">
  <header class="page-header">
    <div class="header-top-row">
      <div class="month-nav">
        <Button
          variant="ghost"
          square
          onclick={() => navigate(-1)}
          aria-label="Previous month"
        >
          <Icon name="left-circle" size={16} />
        </Button>
        <Button
          variant="ghost"
          square
          onclick={() => navigate(1)}
          aria-label="Next month"
        >
          <Icon name="right-circle" size={16} />
        </Button>
      </div>
      <h1 class="month-name">{MONTH_NAMES[month - 1]} {year}</h1>
      {#if summary && needsConversion}
        <Button
          variant="ghost"
          square
          active={converting}
          disabled={fxFetching}
          tooltip={converting
            ? 'Show raw totals'
            : `Convert to ${preferredCurrency}`}
          aria-label={converting
            ? 'Show raw totals'
            : `Convert to ${preferredCurrency}`}
          onclick={handleConvertToggle}
        >
          <Icon name="exchange" size={16} />
        </Button>
      {/if}
    </div>

    {#if summary && currencyEntries.length > 0}
      <div class="chips-row">
        <!-- Total spend chip -->
        <div class="chip">
          <span class="chip-label">Total Spend</span>
          {#each currencyEntries as [c, amount]}
            <div class="chip-amount-row">
              <CurrencyPill code={c} />
              <span class="chip-amount">{formatAmount(amount)}</span>
            </div>
          {/each}
          {#if needsConversion && converting && fxFetching}
            <div class="chip-converted-row chip-converted-loading">
              <span class="spinner" aria-label="Loading"></span>
              <span class="chip-fx-label">
                {fxRemaining > 0
                  ? `${fxRemaining} rate${fxRemaining === 1 ? '' : 's'}…`
                  : 'Converting…'}
              </span>
            </div>
          {:else if needsConversion && converting && convertedTotal !== null}
            <div class="chip-converted-row">
              <span class="chip-converted-eq">≈</span>
              <CurrencyPill code={preferredCurrency} />
              <span class="chip-amount">{formatAmount(convertedTotal)}</span>
            </div>
          {:else if needsConversion && converting && conversionUnavailable}
            <div class="chip-converted-row">
              <span class="chip-warn">Some rates unavailable</span>
            </div>
          {/if}
        </div>

        <!-- vs last month chip -->
        <div class="chip chip-delta">
          <span class="chip-label">vs Last Month</span>
          {#if deltaLastMonth === null}
            <span class="chip-delta-null">—</span>
          {:else}
            {#each currencyEntries as [c]}
              {#if deltaLastMonth[c] !== undefined}
                <div class="chip-delta-row">
                  {#if isMultiCurrency}
                    <CurrencyPill code={c} size="xs" />
                  {/if}
                  <span
                    class="chip-delta-value"
                    class:up={deltaLastMonth[c] > 0}
                    class:down={deltaLastMonth[c] < 0}
                  >
                    {formatDelta(deltaLastMonth[c])}
                  </span>
                </div>
              {/if}
            {/each}
          {/if}
        </div>

        <!-- vs 3-month avg chip -->
        <div class="chip chip-delta">
          <span class="chip-label">vs 3-Mo Avg</span>
          {#if delta3moAvg === null}
            <span class="chip-delta-null">—</span>
          {:else}
            {#each currencyEntries as [c]}
              {#if delta3moAvg[c] !== undefined}
                <div class="chip-delta-row">
                  {#if isMultiCurrency}
                    <CurrencyPill code={c} size="xs" />
                  {/if}
                  <span
                    class="chip-delta-value"
                    class:up={delta3moAvg[c] > 0}
                    class:down={delta3moAvg[c] < 0}
                  >
                    {formatDelta(delta3moAvg[c])}
                  </span>
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  </header>

  {#if loading && !summary}
    <p class="status">Loading…</p>
  {:else if error}
    <p class="status error">{error}</p>
  {:else if !summary || currencies.length === 0}
    <p class="status">No expenses recorded for this month.</p>
  {:else}
    <div class="panels" class:is-loading={loading}>
      <Panel title="Breakdown">
        {#if currencies.length > 1}
          <div class="currency-tabs" role="tablist" aria-label="Currency">
            {#each currencies as c}
              <button
                class="currency-tab"
                class:active={currency === c}
                role="tab"
                aria-selected={currency === c}
                onclick={() => (currency = c)}>{c}</button
              >
            {/each}
          </div>
        {/if}
        <div class="panel-body">
          <nav class="breadcrumb" aria-label="Category navigation">
            {#each breadcrumbs as crumb, i}
              {#if i > 0}<span class="sep" aria-hidden="true">:</span>{/if}
              {#if crumb.current}
                <span class="crumb crumb-current">{crumb.label}</span>
              {:else}
                <button
                  class="crumb crumb-link"
                  onclick={() => navigateTo(crumb.path)}
                >
                  {crumb.label}
                </button>
              {/if}
            {/each}
          </nav>

          <SpendingChart
            categories={summary.categories}
            {currency}
            onclick={drill}
          />
        </div>
      </Panel>

      <Panel title={txnPanelTitle}>
        {#if txnsLoading && txns.length === 0}
          <p class="status">Loading…</p>
        {:else if txns.length === 0}
          <p class="status">No transactions found.</p>
        {:else}
          <div class="txn-list">
            {#each txns as tx (tx.id)}
              <TransactionRow
                {tx}
                {accounts}
                ondeleted={() => {
                  txns = txns.filter((t) => t.id !== tx.id)
                }}
              />
            {/each}
          </div>
        {/if}
      </Panel>
    </div>
  {/if}
</div>

<style>
  /* Page header */
  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    padding: var(--sp-md) var(--sp-xl);
    margin-bottom: var(--sp-xl);
    background: var(--color-window-raised);
    border-left: 4px solid var(--color-accent);
    border-bottom: 1px solid var(--color-border);
  }

  @media (max-width: 520px) {
    .page-header {
      padding: var(--sp-md);
    }
  }

  .header-top-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .month-name {
    font-family: var(--font-serif);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    margin: 0;
  }

  .month-nav {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  /* Chip row */
  .chips-row {
    display: flex;
    align-items: stretch;
    gap: var(--sp-sm);
    flex-wrap: wrap;
  }

  .chip {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: var(--sp-xs) var(--sp-sm);
    box-shadow: var(--shadow-sunken);
    min-width: 0;
  }

  .chip-label {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  /* Totals chip */
  .chip-amount-row {
    display: flex;
    align-items: baseline;
    gap: var(--sp-sm);
  }

  .chip-currency {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .chip-amount {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: var(--weight-normal);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }

  .chip-secondary {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .chip-converted-row {
    display: flex;
    align-items: baseline;
    gap: var(--sp-xs);
    margin-top: 2px;
    padding-top: 3px;
    border-top: 1px solid var(--color-border);
  }

  .chip-converted-loading {
    align-items: center;
  }

  .chip-converted-eq {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .chip-warn {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-warning);
  }

  /* FX fetch status inside chip */
  .chip-fx-status {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .chip-fx-label {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* Delta chips */
  .chip-delta {
    min-width: 7rem;
  }

  .chip-delta-row {
    display: flex;
    align-items: baseline;
    gap: var(--sp-xs);
  }

  .chip-delta-currency {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .chip-delta-value {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
  }

  .chip-delta-value.up {
    color: var(--color-amount-negative);
  }

  .chip-delta-value.down {
    color: var(--color-amount-positive);
  }

  .chip-delta-null {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    color: var(--color-text-disabled);
    line-height: var(--leading-tight);
  }

  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--color-text-muted);
    border-top-color: var(--color-text);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Panels */
  .panels {
    display: flex;
    flex-direction: column;
    gap: var(--sp-lg);
    transition: opacity var(--duration-fast) var(--ease);
  }

  .panels.is-loading {
    opacity: 0.5;
    pointer-events: none;
  }

  /* Currency tabs */
  .currency-tabs {
    display: flex;
    border-bottom: 2px solid var(--color-bevel-dark);
  }

  .currency-tab {
    padding: var(--sp-xs) var(--sp-md);
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    font-weight: var(--weight-normal);
    color: var(--color-text-muted);
    background: var(--color-bevel-mid);
    border: none;
    box-shadow: var(--shadow-raised);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease);
    position: relative;
    bottom: -2px;
  }

  .currency-tab:hover:not(.active) {
    color: var(--color-text);
  }

  .currency-tab.active {
    background: var(--color-window);
    color: var(--color-text);
    font-weight: var(--weight-semibold);
    border-bottom: 2px solid var(--color-window);
    box-shadow:
      inset 1px 0 0 var(--color-bevel-light),
      inset 2px 0 0 var(--color-bevel-mid),
      inset 0 1px 0 var(--color-bevel-light),
      inset 0 2px 0 var(--color-bevel-mid),
      inset -1px 0 0 var(--color-bevel-dark),
      inset -2px 0 0 var(--color-bevel-shadow);
  }

  .panel-body {
    padding: var(--sp-md);
  }

  .status {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--sp-md) 0;
  }

  .status.error {
    color: var(--color-danger);
  }

  .txn-list {
    display: flex;
    flex-direction: column;
  }

  /* Breadcrumb */
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    margin-bottom: var(--sp-md);
    font-size: var(--text-sm);
    font-family: var(--font-mono);
  }

  .sep {
    color: var(--color-text-muted);
    font-weight: var(--weight-semibold);
  }

  .crumb-current {
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .crumb-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--color-accent);
    cursor: pointer;
    text-decoration: underline;
    transition: color var(--duration-fast) var(--ease);
  }

  .crumb-link:hover {
    color: var(--color-accent-mid);
  }
</style>
