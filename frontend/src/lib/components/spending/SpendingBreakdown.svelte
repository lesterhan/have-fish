<script lang="ts">
  import { formatCentsAbs } from '$lib/money'
  import { tooltip } from '$lib/tooltip'
  import Empty from '../ui/Empty.svelte'

  interface Props {
    categories: {
      category: string
      total: Record<string, string>
      childCount: number
    }[]
    currency: string
    activePath?: string | null
    /**
     * The month these figures cover is not fully recorded, so every bar is a floor rather
     * than a length. The bars say so instead of being drawn as if they were final — a
     * magnitude the app knows is partial and draws like a complete one is the same lie as
     * an aggregate that hides its as-of (DESIGN.md §8).
     */
    incomplete?: boolean
    onclick: (category: string, childCount: number) => void
  }

  let {
    categories,
    currency,
    activePath = null,
    incomplete = false,
    onclick,
  }: Props = $props()

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

  /**
   * Two marks, not one string: the filled length carries the figure and the remainder is
   * only the extent of the axis, so they cannot be the same colour. They used to be — both
   * were `--color-accent`, which meant the token that marks the one live thing on a screen
   * was filling nine category bars at once, in a colour the user picks.
   */
  function bar(amount: number): { filled: string; rest: string } {
    const cells =
      maxAbs === 0 ? 0 : Math.round((Math.abs(amount) / maxAbs) * MAX_CELLS)
    return {
      filled: '█'.repeat(cells),
      rest: '░'.repeat(MAX_CELLS - cells),
    }
  }

  function fmtAmount(n: number): string {
    return formatCentsAbs(Math.round(n * 100))
  }
</script>

{#if sorted.length === 0}
  <Empty inset="0">No expenses for this period.</Empty>
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
      {@const cells = bar(cat.amount)}
      <button
        class="row data-row drillable"
        class:active={cat.category === activePath}
        onclick={() => onclick(cat.category, cat.childCount)}
        title={`Drill into ${shortName(cat.category)}`}
      >
        <span
          class="col-cat cat-name drillable"
          use:tooltip={{ label: shortName(cat.category), always: true }}
        >
          {shortName(cat.category)}
        </span>
        <span class="col-bar block-bar">
          <span class="bar-track"
            ><span class="bar-fill" class:incomplete>{cells.filled}</span><span
              class="bar-rest">{cells.rest}</span
            ></span
          >
        </span>
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
    font-size: var(--text-body);
  }

  .row {
    display: grid;
    grid-template-columns: 200px 1fr 110px 50px;
    gap: 12px;
    align-items: baseline;
    padding: 3px 0;
  }

  /* Header row */
  .header-row {
    font-size: var(--text-micro);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-wide);
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

  .data-row.active {
    background: var(--color-accent-chip-bg);
  }

  .col-cat {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-dense);
  }

  /* Ordinary ink. A category name is the row's content, not a link out of it, and nine
     accent-coloured names is the accent marking everything. */
  .cat-name.drillable {
    color: var(--color-text);
  }

  .col-bar {
    overflow: hidden;
    white-space: nowrap;
    font-size: var(--text-control);
    letter-spacing: -1px;
  }

  /* --- The bar --- *
     A magnitude mark is legible against the trough it is drawn in, and the trough is
     `--color-window-inset` — the same ground the coverage strip's marks sit on, so the app
     has one contract for magnitude rather than one per chart. `tokens.test.ts` holds it.

     The track wraps the glyphs rather than the grid cell: a trough that runs to the end of a
     `1fr` column is a well the bar sits at one end of, which reads as a second, much longer
     bar that every category happens to fill completely. */
  .bar-track {
    display: inline-block;
    background: var(--color-window-inset);
    box-shadow: var(--shadow-inset);
    border-radius: var(--radius-sm);
    padding: 0 3px;
  }

  .bar-fill {
    color: var(--color-bar-ink);
  }

  /* The unfilled remainder is deliberately below the 3:1 floor: it is the extent of the
     axis, not a figure. Raising it to meet the fill would draw a second bar. */
  .bar-rest {
    color: var(--color-rule);
  }

  /* The one live thing on the screen — the row you drilled into, and nothing else. */
  .data-row.active .bar-fill {
    color: var(--color-accent);
  }

  .bar-fill.incomplete {
    color: var(--color-incomplete);
  }

  .total-dashes {
    color: var(--color-rule);
    letter-spacing: -1px;
  }

  .col-amt {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
  }

  .amt-cell {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 3px;
  }

  .amt-currency {
    opacity: 0.55;
    font-size: var(--text-micro);
    font-weight: var(--weight-normal);
  }

  .col-pct {
    text-align: right;
    white-space: nowrap;
    font-size: var(--text-label);
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
    font-size: var(--text-body);
    font-weight: var(--weight-bold);
    color: var(--color-text);
  }

  .total-amt {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 3px;
    font-size: var(--text-body);
    font-weight: var(--weight-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }
</style>
