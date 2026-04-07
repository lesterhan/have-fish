<script lang="ts">
  import { Chart, DoughnutController, ArcElement, Tooltip } from 'chart.js'
  import { theme } from '$lib/theme.svelte'

  Chart.register(DoughnutController, ArcElement, Tooltip)

  // Windows system palette — same source as the dashboard, cycled per slice
  const PALETTE_LIGHT = [
    { bg: '#008080', border: '#005050' }, // teal
    { bg: '#800000', border: '#500000' }, // maroon
    { bg: '#000080', border: '#000050' }, // navy
    { bg: '#808000', border: '#505000' }, // olive
    { bg: '#800080', border: '#500050' }, // purple
    { bg: '#006400', border: '#003c00' }, // dark green
    { bg: '#8b4513', border: '#5c2e0c' }, // saddle brown
    { bg: '#4b0082', border: '#2d004e' }, // indigo
  ]

  const PALETTE_DARK = [
    { bg: '#8be9fd', border: '#6ab8c8' }, // cyan
    { bg: '#ff79c6', border: '#cc5fa0' }, // pink
    { bg: '#bd93f9', border: '#9a72cc' }, // purple
    { bg: '#50fa7b', border: '#3ec85f' }, // green
    { bg: '#ffb86c', border: '#cc8f50' }, // orange
    { bg: '#f1fa8c', border: '#c0c86e' }, // yellow
    { bg: '#ff5555', border: '#cc3333' }, // red
    { bg: '#6272a4', border: '#4e5b83' }, // comment blue
  ]

  interface Props {
    categories: { category: string; total: Record<string, string>; childCount: number }[]
    currency: string
    onclick: (category: string) => void
  }

  let { categories, currency, onclick }: Props = $props()

  let canvas = $state<HTMLCanvasElement | null>(null)
  let chartInstance: Chart | null = null

  function cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }

  // Short display name — strip root segment, keep the rest
  // e.g. "expenses:food:restaurant" → "food:restaurant"
  function shortName(category: string): string {
    return category.split(':').slice(1).join(':') || category
  }

  // Sort by amount for selected currency, descending. Filter out categories with no data for currency.
  let sorted = $derived(
    [...categories]
      .filter(c => currency in c.total)
      .map(c => ({ ...c, amount: parseFloat(c.total[currency]) }))
      .sort((a, b) => b.amount - a.amount)
  )

  let total = $derived(sorted.reduce((s, c) => s + c.amount, 0))

  // Which palette to use — recalculated reactively with the theme
  let palette = $derived(theme.dark ? PALETTE_DARK : PALETTE_LIGHT)

  $effect(() => {
    if (!canvas || sorted.length === 0) {
      chartInstance?.destroy()
      chartInstance = null
      return
    }

    const snap       = sorted        // snapshot for closures
    const snapTotal  = total
    const snapPal    = palette
    const textColor  = cssVar('--color-text')
    const mutedColor = cssVar('--color-text-muted')

    // Custom inline plugin: draws "Total" label + amount in the donut center
    const centerTextPlugin = {
      id: 'centerText',
      afterDraw(chart: Chart) {
        const { ctx, chartArea } = chart
        const cx = chartArea.left + chartArea.width / 2
        const cy = chartArea.top  + chartArea.height / 2
        ctx.save()
        ctx.textAlign    = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = mutedColor
        ctx.font      = `11px Tahoma, sans-serif`
        ctx.fillText('Total', cx, cy - 12)
        ctx.fillStyle = textColor
        ctx.font      = `bold 15px Tahoma, sans-serif`
        ctx.fillText(`${currency} ${snapTotal.toFixed(2)}`, cx, cy + 6)
        ctx.restore()
      },
    }

    if (chartInstance) chartInstance.destroy()

    chartInstance = new Chart(canvas, {
      type: 'doughnut',
      plugins: [centerTextPlugin],
      data: {
        labels: snap.map(c => shortName(c.category)),
        datasets: [{
          data: snap.map(c => c.amount),
          backgroundColor: snap.map((_, i) => snapPal[i % snapPal.length].bg),
          borderColor:     snap.map((_, i) => snapPal[i % snapPal.length].border),
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => snap[items[0].dataIndex].category,
              label: (item)  => {
                const amt = item.raw as number
                const pct = snapTotal > 0 ? ((amt / snapTotal) * 100).toFixed(1) : '0.0'
                return ` ${currency} ${amt.toFixed(2)} (${pct}%)`
              },
            },
          },
        },
        onClick(_, elements) {
          if (elements.length === 0) return
          const cat = snap[elements[0].index]
          if (cat.childCount > 0) onclick(cat.category)
        },
        onHover(event, elements) {
          const target = event.native?.target as HTMLCanvasElement | null
          if (!target) return
          if (elements.length === 0) { target.style.cursor = 'default'; return }
          const cat = snap[elements[0].index]
          target.style.cursor = cat.childCount > 0 ? 'pointer' : 'default'
        },
      },
    })

    return () => {
      chartInstance?.destroy()
      chartInstance = null
    }
  })
</script>

{#if sorted.length === 0}
  <p class="empty">No expenses recorded for this month.</p>
{:else}
  <div class="chart-container">
    <!-- Donut canvas -->
    <div class="canvas-wrap">
      <canvas bind:this={canvas}></canvas>
    </div>

    <!-- Custom legend: category + amount + percentage per row -->
    <div class="legend-panel">
      {#each sorted as cat, i}
        {@const pct = total > 0 ? ((cat.amount / total) * 100) : 0}
        <button
          class="legend-row"
          class:drillable={cat.childCount > 0}
          onclick={() => cat.childCount > 0 && onclick(cat.category)}
          title={cat.childCount > 0 ? `Drill into ${shortName(cat.category)}` : undefined}
        >
          <span class="swatch" style="background: {palette[i % palette.length].bg}"></span>
          <span class="cat-name">{shortName(cat.category)}{cat.childCount > 0 ? ' ›' : ''}</span>
          <span class="cat-amount">{currency} {cat.amount.toFixed(2)}</span>
          <span class="cat-pct">{pct.toFixed(1)}%</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .chart-container {
    display: flex;
    gap: var(--sp-xl);
    align-items: flex-start;
  }

  /* Donut takes a fixed square; legend fills the rest */
  .canvas-wrap {
    position: relative;
    flex-shrink: 0;
    width: 280px;
    height: 280px;
  }

  .legend-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding-top: var(--sp-xs);
  }

  .legend-row {
    display: grid;
    grid-template-columns: 10px 1fr auto auto;
    align-items: center;
    gap: var(--sp-sm);
    width: 100%;
    padding: 4px var(--sp-xs);
    background: none;
    border: none;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    text-align: left;
    cursor: default;
    transition: background var(--duration-fast) var(--ease);
  }

  .legend-row.drillable {
    cursor: pointer;
  }

  .legend-row.drillable:hover {
    background: var(--color-accent-light);
  }

  .swatch {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
  }

  .cat-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text);
  }

  .legend-row.drillable .cat-name {
    color: var(--color-accent);
  }

  .cat-amount {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-amount-negative);
    white-space: nowrap;
  }

  .cat-pct {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    white-space: nowrap;
    min-width: 36px;
    text-align: right;
  }

  .empty {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--sp-md) 0;
  }
</style>
