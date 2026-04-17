<script lang="ts">
  import { tooltip } from '$lib/tooltip'

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

  const MAX_CELLS = 22
  const DASHES = '─'.repeat(MAX_CELLS)

  function shortName(category: string): string {
    return category.split(':').slice(1).join(':') || category
  }

  let sorted = $derived(
    [...categories]
      .filter((c) => currency in c.total)
      .map((c) => ({ ...c, amount: parseFloat(c.total[currency]) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
  )

  let total = $derived(sorted.reduce((s, c) => s + c.amount, 0))
  let maxAbs = $derived.by(() => {
    if (sorted.length === 0) return 1
    return Math.max(...sorted.map((c) => Math.abs(c.amount)))
  })

  function bar(amount: number): string {
    if (maxAbs === 0) return '░'.repeat(MAX_CELLS)
    const filled = Math.round((Math.abs(amount) / maxAbs) * MAX_CELLS)
    return '█'.repeat(filled) + '░'.repeat(MAX_CELLS - filled)
  }

  function fmtAmount(n: number): string {
    return Math.abs(n).toLocaleString('en-CA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }
</script>

{#if sorted.length === 0}
  <p class="empty">No expenses for this period.</p>
{:else}
  <div class="breakdown">
    <!-- Header row -->
    <div class="row header-row">
      <span class="col-cat">CATEGORY</span>
      <span class="col-bar">SHARE</span>
      <span class="col-amt">AMOUNT</span>
      <span class="col-pct">%</span>
    </div>

    <!-- Data rows -->
    {#each sorted as cat}
      {@const pct = maxAbs > 0 ? (Math.abs(cat.amount) / maxAbs) * 100 : 0}
      <button
        class="row data-row"
        class:drillable={cat.childCount > 0}
        onclick={() => cat.childCount > 0 && onclick(cat.category)}
        title={cat.childCount > 0 ? `Drill into ${shortName(cat.category)}` : undefined}
      >
        <span
          class="col-cat cat-name"
          class:drillable={cat.childCount > 0}
          use:tooltip={{ label: shortName(cat.category), always: true }}
        >
          {shortName(cat.category)}
        </span>
        <span class="col-bar block-bar">{bar(cat.amount)}</span>
        <span class="col-amt amt-cell">
          <span class="amt-currency">{currency}</span>{fmtAmount(cat.amount)}
        </span>
        <span class="col-pct pct-cell">{Math.round(pct)}%</span>
      </button>
    {/each}

    <!-- Total row -->
    <div class="row total-row">
      <span class="col-cat total-label">= TOTAL</span>
      <span class="col-bar total-dashes">{DASHES}</span>
      <span class="col-amt total-amt">
        <span class="amt-currency">{currency}</span>{fmtAmount(total)}
      </span>
      <span class="col-pct pct-cell">100%</span>
    </div>
  </div>
{/if}

<style>
  .breakdown {
    display: flex;
    flex-direction: column;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .row {
    display: grid;
    grid-template-columns: 130px 1fr 110px 50px;
    gap: 12px;
    align-items: baseline;
    padding: 3px 0;
  }

  /* Header row */
  .header-row {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
    color: var(--color-text-muted);
    padding-bottom: 6px;
    border-bottom: 1px solid var(--color-rule);
    margin-bottom: 2px;
  }

  /* Data rows */
  .data-row {
    background: none;
    border: none;
    width: 100%;
    text-align: left;
    cursor: default;
    color: var(--color-text);
    padding: 3px 0;
    transition: background var(--duration-fast) var(--ease);
  }

  .data-row.drillable {
    cursor: pointer;
  }

  .data-row.drillable:hover {
    background: var(--color-accent-chip-bg);
  }

  .col-cat {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
  }

  .cat-name.drillable {
    color: var(--color-accent);
  }

  .col-bar {
    overflow: hidden;
    white-space: nowrap;
    font-size: 11px;
    color: var(--color-accent);
    letter-spacing: -1px;
  }

.total-dashes {
    color: var(--color-rule);
    letter-spacing: -1px;
  }

  .col-amt {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .amt-cell {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 3px;
  }

  .amt-currency {
    opacity: 0.55;
    font-size: 9px;
    font-weight: 400;
  }

  .col-pct {
    text-align: right;
    white-space: nowrap;
    font-size: 10px;
  }

  .pct-cell {
    color: var(--color-text-muted);
  }

  /* Total row */
  .total-row {
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--color-rule);
  }

  .total-label {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--color-text);
  }

  .total-amt {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 3px;
    font-size: 14px;
    font-weight: 700;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .empty {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--sp-md) 0;
  }
</style>
