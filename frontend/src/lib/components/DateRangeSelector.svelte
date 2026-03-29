<script lang="ts">
  import { toISODate, parseCustomDateRange } from '$lib/date'

  export type DateRange = { from: string; to: string }

  // Preset definitions. Each preset resolves to a DateRange on demand.
  // "custom" is a sentinel value — selecting it reveals the text input.
  type Preset = 'day' | 'week' | 'month' | '3months' | 'custom'

  interface Props {
    value: DateRange
    onchange: (range: DateRange) => void
  }

  let { value, onchange }: Props = $props()

  // Which preset is currently selected in the <select>.
  let selectedPreset = $state<Preset>('month')

  // The raw text the user has typed in the custom input.
  let customInput = $state('')

  // Inline error message shown when the custom input fails to parse.
  let customError = $state('')

  // Whether the custom free-text input is visible.
  let showCustomInput = $derived(selectedPreset === 'custom')

  /**
   * Called when the user picks a preset from the <select>.
   * Immediately resolves and emits the range (except for "custom").
   */
  function handlePresetChange(preset: Preset) {
    // TODO: implement
    // selectedPreset = preset
    // if preset === 'custom': clear customInput and customError, return (don't emit)
    // otherwise: call resolvePreset(preset) and emit via onchange(...)
  }

  /**
   * Maps a preset key to a resolved { from, to } DateRange.
   * "today" is passed in so tests can inject a fixed reference date.
   */
  function resolvePreset(preset: Exclude<Preset, 'custom'>, today = new Date()): DateRange {
    // TODO: implement
    // Subtract the right number of days from `today` for each preset:
    //   day      → today - 1 day
    //   week     → today - 7 days
    //   month    → today - 30 days
    //   3months  → today - 90 days
    // Return { from: toISODate(...), to: toISODate(today) }
    return { from: '', to: '' }
  }

  /**
   * Called on blur or Enter in the custom text input.
   * Parses the input; emits if valid, shows inline error if not.
   */
  function handleCustomCommit() {
    // TODO: implement
    // const result = parseCustomDateRange(customInput)
    // if result is null: set customError to a user-friendly message, return
    // otherwise: clear customError, emit onchange(result)
  }
</script>

<!--
  Layout:
    [ preset <select> ]  [ custom text input (only when "Custom..." selected) ]
    [ inline error message (only when customError is set) ]
-->

<!-- TODO: render a <select> with the five preset options -->
<!-- Preset labels:
  day      → "Past 1 day"
  week     → "Past 1 week"
  month    → "Past 1 month"
  3months  → "Past 3 months"
  custom   → "Custom..."
-->

{#if showCustomInput}
  <!-- TODO: render a TextInput bound to customInput -->
  <!-- On blur and on keydown Enter: call handleCustomCommit() -->
  <!-- placeholder suggestion: "e.g. 90d, 2026-01-01, 2026-01-01 to 2026-03-31" -->
{/if}

{#if customError}
  <!-- TODO: render the error string in a styled .error span -->
{/if}

<style>
  /* TODO: style the wrapper, select, and error span using token variables */
  /* The <select> should match TextInput visually:
       font-family: var(--font-sans)
       font-size: var(--text-sm)
       background: var(--color-window-inset)
       box-shadow: var(--shadow-sunken)
       height: 22px
       border: none
  */

  .error {
    /* TODO: color: var(--color-danger); font-size: var(--text-xs) */
  }
</style>
