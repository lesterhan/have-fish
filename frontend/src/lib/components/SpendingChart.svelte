<script lang="ts">
  import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js'
  import { theme } from '$lib/theme.svelte'

  Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)

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

  // Short label: strip the root segment (e.g. "expenses:food" → "food", "expenses:food:restaurant" → "food:restaurant")
  function shortLabel(category: string, childCount: number): string {
    const short = category.split(':').slice(1).join(':') || category
    return childCount > 0 ? `${short} (${childCount})` : short
  }

  // Sort by amount for selected currency, descending. Filter out categories with no data for currency.
  let sorted = $derived(
    [...categories]
      .filter(c => currency in c.total)
      .map(c => ({ ...c, amount: parseFloat(c.total[currency]) }))
      .sort((a, b) => b.amount - a.amount)
  )

  let chartHeight = $derived(Math.max(200, sorted.length * 40))

  $effect(() => {
    if (!canvas || sorted.length === 0) {
      chartInstance?.destroy()
      chartInstance = null
      return
    }

    const isDark = theme.dark
    const barBg     = isDark ? '#8be9fd' : '#008080'
    const barBorder = isDark ? '#6ab8c8' : '#005050'
    const textColor = cssVar('--color-text')
    const gridColor = cssVar('--color-bevel-dark')

    // Snapshot sorted at chart creation time — closures below capture this value.
    // The effect re-runs (and chart is recreated) whenever sorted changes, so
    // the snapshot is always current at the moment the chart is built.
    const snap = sorted

    if (chartInstance) chartInstance.destroy()

    chartInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: snap.map(c => shortLabel(c.category, c.childCount)),
        datasets: [{
          data: snap.map(c => c.amount),
          backgroundColor: barBg,
          borderColor: barBorder,
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => snap[items[0].dataIndex].category,
              label: (item)  => `${currency} ${(item.raw as number).toFixed(2)}`,
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { font: { family: 'Tahoma, sans-serif', size: 11 }, color: textColor },
            grid: { color: gridColor },
          },
          y: {
            ticks: { font: { family: 'Tahoma, sans-serif', size: 11 }, color: textColor },
            grid: { color: gridColor },
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
  <div class="chart-wrap" style="height: {chartHeight}px">
    <canvas bind:this={canvas}></canvas>
  </div>
{/if}

<style>
  .chart-wrap {
    position: relative;
    width: 100%;
  }

  .empty {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--sp-md) 0;
  }
</style>
