<script lang="ts">
  import { onMount } from 'svelte'
  import HeadingBanner from '$lib/components/ui/HeadingBanner.svelte'
  import SpendingChart from '$lib/components/SpendingChart.svelte'
  import { fetchSpendingSummary } from '$lib/api'
  import type { SpendingSummary } from '$lib/api'

  // --- Date helpers ---

  function monthStart(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}-01`
  }

  function monthEnd(year: number, month: number): string {
    const last = new Date(year, month, 0).getDate()
    return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  }

  function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
    const d = new Date(year, month - 1 + delta, 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  }

  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December']

  // --- State ---
  // Default to the previous calendar month — that's when data is typically complete
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  let year  = $state(prev.getFullYear())
  let month = $state(prev.getMonth() + 1)

  let summary   = $state<SpendingSummary | null>(null)
  let loading   = $state(false)
  let error     = $state<string | null>(null)
  let currency  = $state('CAD')
  // null = top level; a category path like "expenses:food" = drilled into that subtree
  let drillPath = $state<string | null>(null)

  let currencies = $derived(Object.keys(summary?.total ?? {}))

  // Breadcrumb trail derived from drillPath.
  // Each crumb has a label (title-cased segment), the path to navigate to (null = top), and
  // whether it is the current (non-clickable) level.
  type Crumb = { label: string; path: string | null; current: boolean }
  let breadcrumbs = $derived.by<Crumb[]>(() => {
    // Derive the root segment from drillPath or the first category in the summary
    const root = drillPath?.split(':')[0]
      ?? summary?.categories[0]?.category.split(':')[0]
      ?? 'expenses'
    const rootLabel = root.charAt(0).toUpperCase() + root.slice(1)

    if (!drillPath) return [{ label: rootLabel, path: null, current: true }]

    const segments = drillPath.split(':').slice(1) // skip root segment
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
      // Keep current currency if still present in the new data; otherwise fall back
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

  function navigate(delta: number) {
    const next = shiftMonth(year, month, delta)
    year = next.year
    month = next.month
    drillPath = null
    load()
  }

  // Drill into a category — called by SpendingChart when a drillable bar is clicked
  function drill(category: string) {
    drillPath = category
    load()
  }

  // Navigate back to an earlier breadcrumb level
  function navigateTo(path: string | null) {
    drillPath = path
    load()
  }

  onMount(load)
</script>

<HeadingBanner><h1>Spending</h1></HeadingBanner>

<div class="page">
  <div class="controls">
    <div class="month-nav">
      <button class="nav-btn" onclick={() => navigate(-1)} aria-label="Previous month">◀</button>
      <span class="month-label">{MONTH_NAMES[month - 1]} {year}</span>
      <button class="nav-btn" onclick={() => navigate(1)} aria-label="Next month">▶</button>
    </div>

    {#if currencies.length > 1}
      <select class="currency-picker" bind:value={currency}>
        {#each currencies as c}
          <option value={c}>{c}</option>
        {/each}
      </select>
    {/if}
  </div>

  {#if loading}
    <p class="status">Loading…</p>
  {:else if error}
    <p class="status error">{error}</p>
  {:else if !summary || currencies.length === 0}
    <p class="status">No expenses recorded for this month.</p>
  {:else}
    <nav class="breadcrumb" aria-label="Category navigation">
      {#each breadcrumbs as crumb, i}
        {#if i > 0}<span class="sep" aria-hidden="true">›</span>{/if}
        {#if crumb.current}
          <span class="crumb crumb-current">{crumb.label}</span>
        {:else}
          <button class="crumb crumb-link" onclick={() => navigateTo(crumb.path)}>
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
  {/if}
</div>

<style>
  .page {
    padding: 0 var(--sp-lg);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    margin-bottom: var(--sp-lg);
  }

  .month-nav {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
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
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    min-width: 120px;
    text-align: center;
  }

  .currency-picker {
    background: var(--color-window);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 2px var(--sp-xs);
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    color: var(--color-text);
    cursor: pointer;
  }

  .status {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--sp-md) 0;
  }

  .status.error {
    color: var(--color-danger);
  }

  /* Breadcrumb */
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    margin-bottom: var(--sp-md);
    font-size: var(--text-sm);
  }

  .sep {
    color: var(--color-text-muted);
  }

  .crumb-current {
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .crumb-link {
    background: none;
    border: none;
    padding: 0;
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    color: var(--color-accent);
    cursor: pointer;
    text-decoration: underline;
    transition: color var(--duration-fast) var(--ease);
  }

  .crumb-link:hover {
    color: var(--color-accent-mid);
  }

</style>
