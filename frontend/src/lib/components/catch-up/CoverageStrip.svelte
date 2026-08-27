<script lang="ts">
  import { ariaSummary, buildStrip, describeDay, summarizeStrip } from './coverageStrip'

  interface Props {
    from: string
    to: string
    intervals: { fromDate: string; throughDate: string }[]
    horizon: string
    txnDates: string[]
    // Hidden when the strip is one of many on the hub, where a shared legend does the job.
    showLegend?: boolean
    // Inline variant for the account page's status line: a 10px band with no month ruler
    // and no legend, sized to sit beside a sentence rather than to be read on its own.
    compact?: boolean
  }

  let {
    from,
    to,
    intervals,
    horizon,
    txnDates,
    showLegend = true,
    compact = false,
  }: Props = $props()

  let days = $derived(buildStrip({ from, to, intervals, horizon, txnDates }))
  let counts = $derived(summarizeStrip(days))
</script>

<div class="strip-wrap" class:compact>
  {#if !compact}
    <div class="ruler" aria-hidden="true">
      {#each days as day (day.date)}
        <span class="tick-label">{day.monthLabel ?? ''}</span>
      {/each}
    </div>
  {/if}

  <div class="strip" role="img" aria-label={ariaSummary(counts, from, to)}>
    {#each days as day (day.date)}
      <span
        class="day day--{day.state}"
        class:has-txn={day.hasTxn}
        title={describeDay(day)}
      ></span>
    {/each}
  </div>

  {#if showLegend && !compact}
    <div class="legend">
      <span class="legend-item"><span class="swatch day--covered"></span>Covered</span>
      <span class="legend-item"><span class="swatch day--uncovered"></span>Not covered</span>
      {#if counts.beyondHorizon > 0}
        <span class="legend-item"><span class="swatch day--beyond-horizon"></span>Not yet available</span>
      {/if}
      {#if counts.txnsInUncovered > 0}
        <span class="legend-item">
          <span class="swatch day--uncovered has-txn"></span>
          {counts.txnsInUncovered}
          {counts.txnsInUncovered === 1 ? 'day' : 'days'} already entered
        </span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .strip-wrap {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .ruler,
  .strip {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    min-width: 0;
  }

  /* The trough belongs to the whole band, not to each cell. Per-cell shadows turned a run of
     covered days into stripes, which read as ninety separate things rather than as one
     stretch that is done — the shape of coverage is the entire point of the picture. */
  .strip {
    background: var(--color-window-inset);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-inset);
    overflow: hidden;
  }

  .tick-label {
    font-family: var(--font-sans);
    font-size: 9px;
    color: var(--color-text-muted);
    white-space: nowrap;
    line-height: 1;
    /* Labels overflow their 1fr column freely — a day cell is only a few pixels wide, and the
       month name has to sit above its first day without stretching the grid. */
    overflow: visible;
  }

  .day {
    height: 22px;
    position: relative;
    transition: filter var(--duration-fast) var(--ease);
  }

  .compact .day {
    height: 10px;
  }

  /* At 10px the dot would sit on the band's edge — nudge it into the middle instead. */
  .compact .has-txn::after {
    bottom: 2px;
  }

  .day:hover {
    filter: brightness(0.92);
  }

  /* Asserted complete — a solid fill sitting in the trough, so a run of covered days reads as
     one continuous stretch of "done". */
  .day--covered {
    background: linear-gradient(180deg, var(--color-btn-gradient-hi), var(--color-rule));
  }

  /* Unknown. Transparent, so the container's trough shows through: an uncovered stretch is
     literally a hole in the band rather than a differently-coloured thing in it. */
  .day--uncovered {
    background: transparent;
  }

  /* Past the horizon. Hatched rather than filled or empty, so it is plainly a third thing —
     the bank has not published these days yet, and reading them as a gap would be wrong. */
  .day--beyond-horizon {
    background: repeating-linear-gradient(
      -45deg,
      transparent 0 2px,
      var(--color-rule-soft) 2px 4px
    );
  }

  /* The tick sits on the accent over both the fill and the trough; over the fill it needs a
     ring to stay legible against the surrounding grey. */
  .day--covered.has-txn::after {
    box-shadow: 0 0 0 1px var(--color-window-inset);
  }

  /* A day that already has transactions. On an uncovered cell this is the phone-entered split
     sitting inside an open gap. */
  .has-txn::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 3px;
    width: 3px;
    height: 3px;
    margin-left: -1.5px;
    border-radius: 50%;
    background: var(--color-accent);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-sm);
    margin-top: 2px;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 1px;
    position: relative;
  }

  /* Standing alone, a swatch has no band around it — it carries its own trough and border so
     each state is still recognisable out of context. */
  .swatch.day--uncovered,
  .swatch.day--beyond-horizon {
    background-color: var(--color-window-inset);
    box-shadow: var(--shadow-inset);
  }

  .swatch.day--covered {
    border: 1px solid var(--color-rule);
  }

  /* The legend's transaction swatch needs the dot centred in a 10px box, not a day cell. */
  .swatch.has-txn::after {
    bottom: 1px;
  }
</style>
