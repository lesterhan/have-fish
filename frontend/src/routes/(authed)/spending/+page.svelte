<script lang="ts">
  import { onMount } from 'svelte'
  import SpendingBreakdown from '$lib/components/spending/SpendingBreakdown.svelte'
  import SpendingTxnRow from '$lib/components/spending/SpendingTxnRow.svelte'
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
  let txnFilter = $state<string>('ALL')

  // --- FX conversion state ---
  let converting = $state(false)
  let fxFetching = $state(false)
  let fxRemaining = $state(0)
  let convertedTotal = $state<string | null>(null)
  let conversionUnavailable = $state(false)
  let fxRates = $state<Record<string, number>>({})

  let needsConversion = $derived(
    currencyEntries.some(([c]) => c !== preferredCurrency),
  )

  let filteredTxns = $derived(
    txnFilter === 'ALL'
      ? txns
      : txns.filter((tx) => tx.postings.some((p) => p.currency === txnFilter)),
  )

  let pageTotal = $derived.by<number | null>(() => {
    if (!converting || fxFetching || Object.keys(fxRates).length === 0) return null
    return filteredTxns.reduce((sum, tx) => {
      const main =
        tx.postings.find((p) =>
          accounts.find((a) => a.id === p.accountId)?.path.startsWith('expenses:'),
        ) ?? tx.postings[0]
      if (!main) return sum
      return sum + Math.abs(parseFloat(main.amount)) * (fxRates[main.currency] ?? 1)
    }, 0)
  })

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
    fxRates = {}

    const from = monthStart(year, month)
    const to = monthEnd(year, month)

    const { pairs } = await fetchSpendingFxPairs(from, to, preferredCurrency)
    const missing = pairs.filter((p) => !p.cached)
    fxRemaining = missing.length

    const rateMap: Record<string, number> = {}

    if (missing.length > 0) {
      await Promise.all(
        missing.map(async (pair) => {
          const r = await fetchFxRate(pair.date, pair.from, pair.to)
          if (r) rateMap[pair.from] = parseFloat(r.rate)
          fxRemaining -= 1
        }),
      )
    }

    // Fill any currencies not yet in rateMap from cached pairs
    await Promise.all(
      pairs
        .filter((p) => p.cached && !(p.from in rateMap))
        .map(async (pair) => {
          const r = await fetchFxRate(pair.date, pair.from, pair.to)
          if (r) rateMap[pair.from] = parseFloat(r.rate)
        }),
    )

    fxRates = rateMap

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
      fxRates = {}
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
    txnFilter = 'ALL'
    load().then(loadTxns)
  }

  function drill(category: string) {
    drillPath = category
    txnFilter = 'ALL'
    load()
    loadTxns()
  }

  function navigateTo(path: string | null) {
    drillPath = path
    txnFilter = 'ALL'
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
  <div class="left-col" class:is-loading={loading}>
    <div class="month-bar">
      <div class="nav-btns">
        <button class="nav-btn" onclick={() => navigate(-1)} aria-label="Previous month">‹</button>
        <button class="nav-btn" onclick={() => navigate(1)} aria-label="Next month">›</button>
      </div>
      <span class="month-label">{MONTH_NAMES[month - 1]} {year}</span>
      {#if summary && needsConversion}
        <button
          class="convert-btn"
          class:active={converting}
          disabled={fxFetching}
          aria-label={converting ? 'Show raw totals' : `Convert to ${preferredCurrency}`}
          onclick={handleConvertToggle}
        >
          <CurrencyPill code={preferredCurrency} size="xs" />
        </button>
      {/if}
    </div>

    {#if summary && currencyEntries.length > 0}
      <div class="summary-grid">
        <!-- Total Spend -->
        <div class="summary-card">
          <div class="card-label">TOTAL SPEND</div>
          {#each currencyEntries as [c, amount]}
            <div class="card-row">
              <CurrencyPill code={c} size="xs" />
              <span class="card-amount">{formatAmount(amount)}</span>
            </div>
          {/each}
          {#if needsConversion && converting}
            <div class="card-sigma-row">
              {#if fxFetching}
                <span class="card-sigma-badge">Σ TOTAL</span>
                <span class="card-sigma-loading">
                  {fxRemaining > 0 ? `${fxRemaining} rate${fxRemaining === 1 ? '' : 's'}…` : 'Converting…'}
                </span>
              {:else if convertedTotal !== null}
                <span class="card-sigma-badge">Σ TOTAL</span>
                <span class="card-sigma-amount"><CurrencyPill code={preferredCurrency} size="xs" /> {formatAmount(convertedTotal)}</span>
              {:else if conversionUnavailable}
                <span class="card-sigma-warn">Some rates unavailable</span>
              {/if}
            </div>
          {/if}
        </div>

        <!-- vs Last Month -->
        <div class="summary-card">
          <div class="card-label">VS LAST MONTH</div>
          {#if deltaLastMonth === null}
            <span class="card-null">—</span>
          {:else}
            {#each currencyEntries as [c]}
              {#if deltaLastMonth[c] !== undefined}
                <div class="card-row">
                  {#if isMultiCurrency}<CurrencyPill code={c} size="xs" />{/if}
                  <span class="card-delta" class:up={deltaLastMonth[c] > 0} class:down={deltaLastMonth[c] < 0}>
                    {formatDelta(deltaLastMonth[c])}
                  </span>
                </div>
              {/if}
            {/each}
          {/if}
        </div>

        <!-- vs 3-Month Avg -->
        <div class="summary-card">
          <div class="card-label">VS 3-MO AVG</div>
          {#if delta3moAvg === null}
            <span class="card-null">—</span>
          {:else}
            {#each currencyEntries as [c]}
              {#if delta3moAvg[c] !== undefined}
                <div class="card-row">
                  {#if isMultiCurrency}<CurrencyPill code={c} size="xs" />{/if}
                  <span class="card-delta" class:up={delta3moAvg[c] > 0} class:down={delta3moAvg[c] < 0}>
                    {formatDelta(delta3moAvg[c])}
                  </span>
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      </div>
    {/if}

    {#if loading && !summary}
      <p class="status">Loading…</p>
    {:else if error}
      <p class="status error">{error}</p>
    {:else if !summary || currencies.length === 0}
      <p class="status">No expenses recorded for this month.</p>
    {:else}
      <div class="breakdown-section">
        <div class="section-bar">
          <span class="section-bar-title">Breakdown · {summary.categories.length} categories</span>
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
        </div>
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
          <SpendingBreakdown
            categories={summary.categories}
            {currency}
            onclick={drill}
          />
        </div>
      </div>
    {/if}
  </div>

  <div class="right-col">
    <div class="txn-panel">
      <div class="txn-header">
        <span class="txn-header-title">Transactions</span>
        <span class="txn-header-count">{txns.length} entries</span>
        <span class="txn-header-spacer"></span>
        <a
          class="txn-view-all"
          href="/transactions?from={monthStart(year, month)}&to={monthEnd(year, month)}"
        >VIEW ALL</a>
      </div>
      <div class="txn-toolbar">
        <span class="txn-toolbar-label">FILTER</span>
        <button
          class="filter-chip"
          class:active={txnFilter === 'ALL'}
          onclick={() => (txnFilter = 'ALL')}
        >ALL</button>
        {#each currencies as c}
          <button
            class="filter-chip"
            class:active={txnFilter === c}
            onclick={() => (txnFilter = c)}
          >{c}</button>
        {/each}
        <span class="txn-toolbar-spacer"></span>
        <span class="txn-sort-label">↑↓ DATE</span>
      </div>
      <div class="txn-col-header">
        <span>DATE</span>
        <span>PAYEE / ACCOUNT</span>
        <span class="col-header-right">AMOUNT</span>
      </div>
      <div class="txn-body">
        {#if txnsLoading && txns.length === 0}
          <p class="status">Loading…</p>
        {:else if txns.length === 0}
          <p class="status">No transactions found.</p>
        {:else}
          <div class="txn-list">
            {#each filteredTxns as tx, i (tx.id)}
              <SpendingTxnRow
                {tx}
                idx={i}
                converted={converting && !fxFetching}
                {fxRates}
                baseCurrency={preferredCurrency}
                {accounts}
              />
            {/each}
          </div>
        {/if}
      </div>
      <div class="txn-footer">
        <span class="txn-footer-count">SHOWING {filteredTxns.length} / {txns.length}</span>
        <span class="txn-footer-spacer"></span>
        {#if pageTotal !== null}
          <span class="txn-footer-label">page total</span>
          <span class="txn-footer-total">
            {pageTotal.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            {preferredCurrency}
          </span>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  /* Month bar */
  .month-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 22px 10px;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
    flex-shrink: 0;
  }

  .nav-btns {
    display: flex;
    gap: 4px;
  }

  .nav-btn {
    width: 24px;
    height: 22px;
    background: linear-gradient(180deg, #ffffff, var(--color-rule-soft));
    border: 1px solid var(--color-rule);
    border-radius: 3px;
    font-family: var(--font-serif);
    font-size: 16px;
    color: var(--color-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    transition: box-shadow var(--duration-fast) var(--ease);
  }

  .nav-btn:hover {
    box-shadow: var(--shadow-raised);
  }

  .nav-btn:active {
    box-shadow: var(--shadow-sunken);
  }

  .month-label {
    font-family: var(--font-serif);
    font-size: 24px;
    font-weight: 600;
    color: var(--color-text);
    letter-spacing: -0.2px;
  }

  .convert-btn {
    height: 24px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: linear-gradient(180deg, #ffffff, var(--color-rule-soft));
    border: 1px solid var(--color-rule);
    border-radius: 3px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text);
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
    transition:
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .convert-btn.active {
    background: linear-gradient(180deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 80%, transparent));
    border-color: var(--color-accent);
    color: #ffffff;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
  }

  .convert-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Summary grid */
  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    border-bottom: 1px solid var(--color-rule);
    flex-shrink: 0;
  }

  .summary-card {
    padding: 14px 22px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-left: 1px solid var(--color-rule);
  }

  .summary-card:first-child {
    border-left: none;
  }

  .card-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.2px;
    color: var(--color-accent);
    margin-bottom: 6px;
  }

  .card-row {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    gap: 10px;
  }

  .card-amount {
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 600;
    color: var(--color-text);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .card-delta {
    font-family: var(--font-mono);
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .card-delta.up {
    color: var(--color-amount-negative);
  }

  .card-delta.down {
    color: var(--color-amount-positive);
  }

  .card-null {
    font-family: var(--font-mono);
    font-size: 18px;
    color: var(--color-text-disabled);
  }

  .card-sigma-row {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    gap: 10px;
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px dashed var(--color-accent);
  }

  .card-sigma-badge {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.6px;
    color: #ffffff;
    background: var(--color-accent);
    padding: 2px 5px;
    line-height: 1;
  }

  .card-sigma-amount {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 19px;
    font-weight: 700;
    color: var(--color-accent);
    font-variant-numeric: tabular-nums;
  }

  .card-sigma-loading {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    text-align: right;
  }

  .card-sigma-warn {
    font-family: var(--font-sans);
    font-size: 10px;
    color: var(--color-warning);
    grid-column: 1 / -1;
  }

  /* Page grid */
  .page {
    display: grid;
    grid-template-columns: 1fr 360px;
    height: 100%;
    overflow: hidden;
  }

  .left-col {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-right: 1px solid var(--color-rule);
    transition: opacity var(--duration-fast) var(--ease);
  }

  .left-col.is-loading {
    opacity: 0.5;
    pointer-events: none;
  }

  .right-col {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Txn panel */
  .txn-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--color-window-raised);
  }

  .txn-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
    flex-shrink: 0;
  }

  .txn-header-title {
    font-family: var(--font-serif);
    font-size: 14px;
    font-weight: 700;
  }

  .txn-header-count {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 400;
    opacity: 0.75;
  }

  .txn-header-spacer {
    flex: 1;
  }

  .txn-view-all {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: var(--color-section-bar-fg);
    opacity: 0.75;
    text-decoration: none;
    transition: opacity var(--duration-fast) var(--ease);
  }

  .txn-view-all:hover {
    opacity: 1;
  }

  .txn-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-bottom: 1px solid var(--color-rule);
    flex-shrink: 0;
    background: var(--color-window);
  }

  .txn-toolbar-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    color: var(--color-text-muted);
    margin-right: 2px;
  }

  .filter-chip {
    padding: 2px 8px;
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    background: var(--color-window);
    color: var(--color-text);
    border: 1px solid var(--color-rule);
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }

  .filter-chip.active {
    background: var(--color-accent);
    color: #ffffff;
    border-color: var(--color-accent);
  }

  .filter-chip:not(.active):hover {
    background: var(--color-accent-chip-bg);
  }

  .txn-toolbar-spacer {
    flex: 1;
  }

  .txn-sort-label {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
  }

  .txn-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-top: 1px solid var(--color-sidebar-border);
    background: linear-gradient(180deg, #ffffff, var(--color-rule-soft));
    flex-shrink: 0;
  }

  .txn-footer-count {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--color-text-muted);
  }

  .txn-footer-spacer {
    flex: 1;
  }

  .txn-footer-label {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
  }

  .txn-footer-total {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--color-accent);
    font-variant-numeric: tabular-nums;
  }

  .txn-col-header {
    display: grid;
    grid-template-columns: 52px 1fr auto;
    gap: 10px;
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
  }

  .col-header-right {
    text-align: right;
  }

  .txn-body {
    flex: 1;
    overflow-y: auto;
  }

  /* Breakdown section */
  .breakdown-section {
    display: flex;
    flex-direction: column;
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
  }

  .section-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: 4px 12px;
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .section-bar .breadcrumb {
    margin-bottom: 0;
    color: var(--color-section-bar-fg);
    opacity: 0.85;
  }

  .section-bar .sep {
    color: var(--color-section-bar-fg);
    opacity: 0.5;
  }

  .section-bar .crumb-current {
    color: var(--color-section-bar-fg);
  }

  .section-bar .crumb-link {
    color: var(--color-section-bar-fg);
    opacity: 0.7;
  }

  .section-bar .crumb-link:hover {
    color: var(--color-section-bar-fg);
    opacity: 1;
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
