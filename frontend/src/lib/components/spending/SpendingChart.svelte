<script lang="ts">
  import { Chart, DoughnutController, ArcElement, Tooltip } from 'chart.js'
  import { theme } from '$lib/theme.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'

  Chart.register(DoughnutController, ArcElement, Tooltip)

  // Medium-saturation palette — readable on light and dark window backgrounds
  const PALETTE_LIGHT = [
    { bg: '#5b9bd5', border: '#3f7ab8' }, // blue
    { bg: '#e8834a', border: '#c06228' }, // orange
    { bg: '#48bb78', border: '#2d9e56' }, // green
    { bg: '#e05c5c', border: '#be3838' }, // red
    { bg: '#38b2ac', border: '#1e8a85' }, // teal
    { bg: '#c89e2e', border: '#a07a10' }, // amber
    { bg: '#805ad5', border: '#6040b8' }, // purple
    { bg: '#d6609a', border: '#b03c7c' }, // pink
  ]

  const PALETTE_DARK = [
    { bg: '#7eb8ef', border: '#5b9bd5' }, // blue
    { bg: '#f5a86a', border: '#e8834a' }, // orange
    { bg: '#68d391', border: '#48bb78' }, // green
    { bg: '#fc8181', border: '#e05c5c' }, // red
    { bg: '#4fd1cc', border: '#38b2ac' }, // teal
    { bg: '#f0d060', border: '#c89e2e' }, // amber
    { bg: '#9f7aea', border: '#805ad5' }, // purple
    { bg: '#f093c0', border: '#d6609a' }, // pink
  ]

  interface Props {
    categories: {
      category: string
      total: Record<string, string>
      childCount: number
    }[]
    currency: string
    onclick: (category: string) => void
  }

  let { categories, currency, onclick }: Props = $props()

  let canvas = $state<HTMLCanvasElement | null>(null)
  let chartInstance: Chart | null = null

  function cssVar(name: string): string {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim()
  }

  // Short display name — strip root segment, keep the rest
  // e.g. "expenses:food:restaurant" → "food:restaurant"
  function shortName(category: string): string {
    return category.split(':').slice(1).join(':') || category
  }

  // Sort by amount for selected currency, descending. Filter out categories with no data for currency.
  let sorted = $derived(
    [...categories]
      .filter((c) => currency in c.total)
      .map((c) => ({ ...c, amount: parseFloat(c.total[currency]) }))
      .sort((a, b) => b.amount - a.amount),
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

    const snap = sorted // snapshot for closures
    const snapTotal = total
    const snapPal = palette
    const textColor = cssVar('--color-text')
    const mutedColor = cssVar('--color-text-muted')

    // Custom inline plugin: draws "Total" label + amount in the donut center.
    // Uses afterDatasetsDraw so it renders before the tooltip layer, not over it.
    const centerTextPlugin = {
      id: 'centerText',
      afterDatasetsDraw(chart: Chart) {
        const { ctx, chartArea } = chart
        const cx = chartArea.left + chartArea.width / 2
        const cy = chartArea.top + chartArea.height / 2
        ctx.save()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = mutedColor
        ctx.font = `11px Tahoma, sans-serif`
        ctx.fillText('Total', cx, cy - 12)
        ctx.fillStyle = textColor
        ctx.font = `bold 15px Tahoma, sans-serif`
        ctx.fillText(`${currency} ${snapTotal.toFixed(2)}`, cx, cy + 6)
        ctx.restore()
      },
    }

    if (chartInstance) chartInstance.destroy()

    chartInstance = new Chart(canvas, {
      type: 'doughnut',
      plugins: [centerTextPlugin],
      data: {
        labels: snap.map((c) => shortName(c.category)),
        datasets: [
          {
            data: snap.map((c) => c.amount),
            backgroundColor: snap.map((_, i) => snapPal[i % snapPal.length].bg),
            borderColor: snap.map((_, i) => snapPal[i % snapPal.length].border),
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(30, 30, 30, 0.95)',
            titleColor: '#ffffff',
            bodyColor: '#cccccc',
            callbacks: {
              title: (items) => snap[items[0].dataIndex].category,
              label: (item) => {
                const amt = item.raw as number
                const pct =
                  snapTotal > 0 ? ((amt / snapTotal) * 100).toFixed(1) : '0.0'
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
          if (elements.length === 0) {
            target.style.cursor = 'default'
            return
          }
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
        {@const pct = total > 0 ? (cat.amount / total) * 100 : 0}
        <button
          class="legend-row"
          class:drillable={cat.childCount > 0}
          onclick={() => cat.childCount > 0 && onclick(cat.category)}
          title={cat.childCount > 0
            ? `Drill into ${shortName(cat.category)}`
            : undefined}
        >
          <span
            class="swatch"
            style="background: {palette[i % palette.length].bg}"
          ></span>
          <span class="cat-name"
            >{shortName(cat.category)}
            <Icon name={cat.childCount > 0 ? 'more' : ''} size={10} />
          </span>
          <span class="cat-currency">
            {currency}
          </span>
          <span class="cat-amount">{cat.amount.toFixed(2)}</span>
          <span class="cat-pct">{Math.round(pct)}%</span>
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
    grid-template-columns: 10px 1fr auto auto auto;
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

  .cat-currency {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: nowrap;
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
    color: var(--color-text);
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

  @media (max-width: 520px) {
    .chart-container {
      flex-direction: column;
      align-items: center;
      gap: var(--sp-md);
    }

    .canvas-wrap {
      width: 200px;
      height: 200px;
    }

    .legend-panel {
      width: 100%;
      padding-top: 0;
    }

    .legend-row {
      min-height: 36px;
    }
  }
</style>
