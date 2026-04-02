<script lang="ts">
  import { onMount } from 'svelte'
  import Panel from '$lib/components/Panel.svelte'
  import { fetchSpendingSummary, fetchWeeklySpend } from '$lib/api'
  import type { SpendingSummary, WeeklySpend } from '$lib/api'
  import { Chart, BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js'

  Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend)

  // --- Date helpers ---

  function monthStart(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}-01`
  }

  function monthEnd(year: number, month: number): string {
    const last = new Date(year, month, 0).getDate() // day 0 of next month = last day of this month
    return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  }

  // Shift a { year, month } by +/- N months, wrapping correctly
  function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
    const d = new Date(year, month - 1 + delta, 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  }

  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December']

  // --- State ---
  const now = new Date()
  let year = $state(now.getFullYear())
  let month = $state(now.getMonth() + 1)

  let summary = $state<SpendingSummary | null>(null)
  let avgTotal = $state<Record<string, string>>({}) // trailing 3-month average per currency
  let loading = $state(false)

  async function load() {
    loading = true
    try {
      const from = monthStart(year, month)
      const to = monthEnd(year, month)

      // Trailing 3-month window ending the month before the selected month
      const prev3end = shiftMonth(year, month, -1)
      const prev3start = shiftMonth(year, month, -3)

      const [cur, avg3] = await Promise.all([
        fetchSpendingSummary(from, to),
        fetchSpendingSummary(
          monthStart(prev3start.year, prev3start.month),
          monthEnd(prev3end.year, prev3end.month),
        ),
      ])

      summary = cur

      // Divide 3-month totals by 3 to get per-month average
      avgTotal = Object.fromEntries(
        Object.entries(avg3.total).map(([currency, amount]) => [
          currency,
          (parseFloat(amount) / 3).toFixed(2),
        ])
      )
    } finally {
      loading = false
    }
  }

  // --- Spend history chart ---
  // Window options as labels → approximate week counts
  const WINDOW_OPTIONS = [
    { label: '3mo', weeks: 13 },
    { label: '6mo', weeks: 26 },
    { label: '12mo', weeks: 52 },
  ] as const
  type WindowLabel = typeof WINDOW_OPTIONS[number]['label']

  let historyWindow = $state<WindowLabel>('3mo')
  let historyData = $state<WeeklySpend[]>([])
  let chartCanvas = $state<HTMLCanvasElement | null>(null)
  let chartInstance: Chart | null = null

  function currentWeeks(): number {
    return WINDOW_OPTIONS.find(o => o.label === historyWindow)!.weeks
  }

  async function loadHistory() {
    historyData = await fetchWeeklySpend(currentWeeks())
  }

  // Format "YYYY-MM-DD" → "Apr 7"
  const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  function formatWeekLabel(weekStart: string): string {
    const [, m, d] = weekStart.split('-').map(Number)
    return `${SHORT_MONTHS[m - 1]} ${d}`
  }

  // Collect all currencies across the window
  function historyCurrencies(): string[] {
    const set = new Set<string>()
    for (const m of historyData) Object.keys(m.total).forEach(c => set.add(c))
    return [...set]
  }

  // Windows 98 system palette — one colour per currency
  const WIN_COLOURS = [
    { bg: '#008080', border: '#005050' }, // teal
    { bg: '#800000', border: '#500000' }, // maroon
    { bg: '#000080', border: '#000050' }, // navy
    { bg: '#808000', border: '#505000' }, // olive
    { bg: '#800080', border: '#500050' }, // purple
  ]

  // Resolve a CSS variable to its computed value so Chart.js gets a real colour string
  function cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }

  $effect(() => {
    if (!chartCanvas || historyData.length === 0) return

    const textColour = cssVar('--color-text')
    const gridColour = cssVar('--color-bevel-dark')

    const labels = historyData.map(m => formatWeekLabel(m.weekStart))
    const currencies = historyCurrencies()

    // Average across all currencies combined (sum of per-currency averages)
    const avg = currencies.reduce((sum, currency) => {
      const total = historyData.reduce((s, m) => s + parseFloat(m.total[currency] ?? '0'), 0)
      return sum + total / historyData.length
    }, 0)

    const datasets = currencies.map((currency, i) => {
      const { bg, border } = WIN_COLOURS[i % WIN_COLOURS.length]
      return {
        label: currency,
        data: historyData.map(m => parseFloat(m.total[currency] ?? '0')),
        backgroundColor: bg,
        borderColor: border,
        borderWidth: 1,
        stack: 'spend',
      }
    })

    // Average line
    datasets.push({
      label: 'Avg',
      data: historyData.map(() => avg),
      backgroundColor: 'rgba(0,0,0,0)',
      // @ts-expect-error — mixed type requires Chart.js type extension
      type: 'line',
      borderColor: '#cc0000',
      borderWidth: 1,
      borderDash: [4, 4],
      pointRadius: 0,
      stack: undefined,
    })

    if (chartInstance) chartInstance.destroy()
    chartInstance = new Chart(chartCanvas, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { font: { family: 'Tahoma, sans-serif', size: 11 }, color: textColour },
          },
          tooltip: { mode: 'index' },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { font: { family: 'Tahoma, sans-serif', size: 11 }, color: textColour },
            grid: { color: gridColour },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { font: { family: 'Tahoma, sans-serif', size: 11 }, color: textColour },
            grid: { color: gridColour },
          },
        },
      },
    })
  })

  onMount(() => { load(); loadHistory() })

  function navigate(delta: number) {
    const next = shiftMonth(year, month, delta)
    year = next.year
    month = next.month
    load()
  }

  // --- Delta calculation ---
  // Returns the % change from avg to current for a given currency, or null if no avg
  function delta(currency: string): number | null {
    const cur = parseFloat(summary?.total[currency] ?? '0')
    const avg = parseFloat(avgTotal[currency] ?? '0')
    if (avg === 0) return null
    return ((cur - avg) / avg) * 100
  }

  // Currencies present in the current month's summary
  let currencies = $derived(Object.keys(summary?.total ?? {}))

  // Categories sorted by total for a given currency, descending
  function categoriesForCurrency(currency: string) {
    const total = parseFloat(summary?.total[currency] ?? '0')
    return (summary?.categories ?? [])
      .filter(cat => currency in cat.total)
      .map(cat => ({
        name: cat.category,
        amount: parseFloat(cat.total[currency]),
        pct: total > 0 ? (parseFloat(cat.total[currency]) / total) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
  }
</script>

<div class="dashboard-grid">
  <Panel title="THIS MONTH">
    <div class="panel-content">
      <!-- Month navigation -->
      <div class="month-nav">
        <button class="nav-btn" onclick={() => navigate(-1)} aria-label="Previous month">◀</button>
        <span class="month-label">{MONTH_NAMES[month - 1]} {year}</span>
        <button class="nav-btn" onclick={() => navigate(1)} aria-label="Next month">▶</button>
      </div>

      {#if loading}
        <p class="empty">Loading…</p>
      {:else if currencies.length === 0}
        <p class="empty">No expenses recorded.</p>
      {:else}
        {#each currencies as currency}
          {@const d = delta(currency)}
          <div class="currency-section">
            <!-- Total row -->
            <div class="total-row">
              <span class="total-amount">{summary?.total[currency]} {currency}</span>
              {#if d !== null}
                <span class="delta" class:positive={d <= 0} class:negative={d > 0}>
                  {d > 0 ? '+' : ''}{d.toFixed(1)}%
                </span>
                <span class="avg-label">vs 3mo avg {avgTotal[currency]} {currency}</span>
              {/if}
            </div>

            <!-- Category bars -->
            <div class="categories">
              {#each categoriesForCurrency(currency) as cat}
                <div class="cat-row">
                  <span class="cat-name">{cat.name.replace(/^[^:]+:/, '')}</span>
                  <div class="bar-track">
                    <div class="bar-fill" style="width: {cat.pct}%"></div>
                  </div>
                  <span class="cat-amount">{cat.amount.toFixed(2)}</span>
                  <span class="cat-pct">{cat.pct.toFixed(0)}%</span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </Panel>

  <Panel title="CASH POSITION">
    <div class="panel-content empty">
      <!-- Story 5 -->
    </div>
  </Panel>
</div>

<Panel title="SPENDING HISTORY">
  <div class="panel-content">
    <div class="history-controls">
      {#each WINDOW_OPTIONS as opt}
        <button
          class="window-btn"
          class:active={historyWindow === opt.label}
          onclick={() => { historyWindow = opt.label; loadHistory() }}
        >{opt.label}</button>
      {/each}
    </div>
    <div class="chart-wrap">
      <canvas bind:this={chartCanvas}></canvas>
    </div>
  </div>
</Panel>

<style>
  .dashboard-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-xl);
    margin-bottom: var(--sp-xl);
  }

  .panel-content {
    padding: var(--sp-md);
    min-height: 80px;
  }

  /* Spend history */
  .history-controls {
    display: flex;
    gap: var(--sp-xs);
    margin-bottom: var(--sp-sm);
  }

  .window-btn {
    background: var(--color-window);
    border: none;
    box-shadow: var(--shadow-raised);
    padding: 1px var(--sp-sm);
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    color: var(--color-text);
    cursor: pointer;
    transition: box-shadow var(--duration-fast) var(--ease);
  }

  .window-btn:hover {
    background: var(--color-accent-light);
  }

  .window-btn.active {
    box-shadow: var(--shadow-sunken);
    background: var(--color-accent-light);
    color: var(--color-accent);
    font-weight: var(--weight-semibold);
  }

  .chart-wrap {
    height: 220px;
    position: relative;
  }

  /* Month navigation */
  .month-nav {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    margin-bottom: var(--sp-md);
    padding-bottom: var(--sp-sm);
    border-bottom: 1px solid var(--color-border);
  }

  .nav-btn {
    background: var(--color-window);
    border: none;
    box-shadow: var(--shadow-raised);
    padding: 1px var(--sp-xs);
    font-size: var(--text-xs);
    color: var(--color-text);
    cursor: pointer;
    font-family: var(--font-sans);
    transition: box-shadow var(--duration-fast) var(--ease);
  }

  .nav-btn:hover {
    background: var(--color-accent-light);
  }

  .nav-btn:active {
    box-shadow: var(--shadow-sunken);
  }

  .month-label {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    flex: 1;
    text-align: center;
  }

  /* Total row */
  .currency-section {
    margin-bottom: var(--sp-md);
  }

  .currency-section:last-child {
    margin-bottom: 0;
  }

  .total-row {
    display: flex;
    align-items: baseline;
    gap: var(--sp-sm);
    margin-bottom: var(--sp-sm);
  }

  .total-amount {
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    color: var(--color-amount-negative);
  }

  .delta {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .delta.negative {
    color: var(--color-amount-negative);
  }

  .delta.positive {
    color: var(--color-amount-positive);
  }

  .avg-label {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* Category bars */
  .categories {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .cat-row {
    display: grid;
    grid-template-columns: 140px 1fr 60px 32px;
    align-items: center;
    gap: var(--sp-xs);
    font-size: var(--text-xs);
  }

  .cat-name {
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bar-track {
    height: 8px;
    background: var(--color-window);
    box-shadow: var(--shadow-sunken);
  }

  .bar-fill {
    height: 100%;
    background: var(--color-accent-mid);
    transition: width var(--duration-normal) var(--ease);
  }

  .cat-amount {
    text-align: right;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .cat-pct {
    text-align: right;
    color: var(--color-text-muted);
  }

  .empty {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
</style>
