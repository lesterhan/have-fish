<script lang="ts">
  import { formatCents } from '$lib/money'
  import { parseDateParts } from './transactionUtils'
  import type { DayNet } from './ledger'

  /**
   * One day of a ledger, as a band.
   *
   * The date used to be a column on every row, repeated for every transaction on the same
   * day — five identical dates down the left of a busy Saturday, none of them telling you
   * anything the one above hadn't. Lifting it into a band says it once and gives the run a
   * shape, which is also what lets the zebra striping go: the structure is the band, not an
   * alternating fill (DESIGN.md §5).
   *
   * The band earns the space it takes by carrying the day's net, which nothing on either
   * page reported before.
   */
  interface Props {
    /** `YYYY-MM-DD`. */
    date: string
    count: number
    net: DayNet
  }

  let { date, count, net }: Props = $props()

  let parts = $derived(parseDateParts(date))
</script>

<div class="day-band section-bar">
  <span class="day-date">
    <span class="dow">{parts.dow}</span>
    <span class="month-day">{parts.monthDay}</span>
    <span class="year">{parts.year}</span>
  </span>

  <span class="day-count">{count} {count === 1 ? 'entry' : 'entries'}</span>

  {#if net.kind === 'net'}
    <!-- Same rule as the rows below it, for the same reason: over a month of bands most days
         net negative, so tinting those paints a column of red down a page of ordinary weeks.
         The minus carries the sign; colour marks the day money came back. -->
    <span class="day-net" class:positive={net.cents > 0}>
      {formatCents(net.cents)}
      <span class="unit">{net.currency}</span>
    </span>
  {:else if net.kind === 'mixed'}
    <!-- An absence with a reason rather than a blank: adding these would invent a rate, and
         showing one currency's subtotal would be a figure that looks like the day's net and
         is not. -->
    <span
      class="day-net muted"
      title="Add a conversion to see one figure for the day"
    >
      {net.currencies.join(' · ')} — no single net
    </span>
  {/if}
</div>

<style>
  .day-band {
    display: flex;
    align-items: baseline;
    gap: var(--sp-sm);
    height: 29px;
    padding: 0 14px;
  }

  .day-date {
    display: flex;
    align-items: baseline;
    gap: var(--sp-xs);
    font-family: var(--font-mono);
    font-size: var(--text-body);
    white-space: nowrap;
  }

  .month-day {
    font-weight: var(--weight-bold);
  }

  .dow,
  .year,
  .day-count,
  .unit,
  .muted {
    color: var(--color-text-muted);
    font-size: var(--text-dense);
  }

  .day-count {
    font-family: var(--font-mono);
  }

  .day-net {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-body);
    white-space: nowrap;
  }

  .day-net.positive {
    color: var(--color-amount-positive);
  }
</style>
