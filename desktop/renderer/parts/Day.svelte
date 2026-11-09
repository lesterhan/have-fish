<script lang="ts">
  // A day as it reads everywhere: `Thu 5 Nov`, the year when it isn't this one, in the figures
  // face. A band says Today or Yesterday before it. `full` always says the year, quiet, as the
  // composer's date list does. The rules are `day` in `format.ts`.
  import { copy } from '../../copy'
  import { bandDay, day, dayParts, todayIn } from '../format'

  type Props = {
    /** `YYYY-MM-DD`. */
    date: string
    /** Asked again by a list on each change, so a day past midnight reads right. */
    today?: string | undefined
    /** A day band's: Today and Yesterday say so. */
    band?: boolean
    /** The last day of a run that starts at `date`. */
    until?: string | undefined
    /** Always with the year, quiet: the date list confirms the day a shorthand means. */
    full?: boolean
  }
  let { date, today = todayIn(), band = false, until, full = false }: Props = $props()

  const shown = $derived(bandDay(date, today))
  const parts = $derived(dayParts(date))
</script>

{#if until !== undefined}
  <time datetime={date}>{copy.app.days.span(shown.day, day(until, today))}</time>
{:else if full}
  <time datetime={date}>{parts.weekday} {parts.day} {parts.month} <span class="year"
      >{parts.year}</span
    ></time
  >
{:else}
  {#if band && shown.lead !== null}<span class="lead">{copy.app.days[shown.lead]}</span>{' · '}{/if}<time
    datetime={date}>{shown.day}</time
  >
{/if}

<style>
  time {
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .year {
    color: var(--color-muted);
  }
</style>
