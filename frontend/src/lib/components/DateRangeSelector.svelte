<script lang="ts">
  import { toISODate, parseCustomDateRange } from '$lib/date'

  export type DateRange = { from: string; to: string }

  type Preset = 'day' | 'week' | 'month' | '3months' | 'custom'

  interface Props {
    value: DateRange
    onchange: (range: DateRange) => void
  }

  let { value, onchange }: Props = $props()

  function resolvePreset(preset: Exclude<Preset, 'custom'>, today = new Date()): DateRange {
    const days = { day: 1, week: 7, month: 30, '3months': 90 }[preset]
    const from = new Date(today)
    from.setDate(today.getDate() - days)
    return { from: toISODate(from), to: toISODate(today) }
  }

  // Infer which preset (if any) matches the incoming value.
  // If none match, fall back to 'custom' and pre-populate the text input.
  function inferPreset(v: DateRange): Preset {
    for (const preset of ['day', 'week', 'month', '3months'] as const) {
      const r = resolvePreset(preset)
      if (r.from === v.from && r.to === v.to) return preset
    }
    return 'custom'
  }

  let selectedPreset = $state<Preset>(inferPreset(value))
  let customInput = $state(selectedPreset === 'custom' ? `${value.from} to ${value.to}` : '')
  let customError = $state('')

  let showCustomInput = $derived(selectedPreset === 'custom')

  function handlePresetChange(preset: Preset) {
    selectedPreset = preset
    if (preset === 'custom') {
      customInput = ''
      customError = ''
      return
    }
    onchange(resolvePreset(preset))
  }

  function handleCustomCommit() {
    const result = parseCustomDateRange(customInput)
    if (result === null) {
      customError = 'Could not parse date — try "90d", "2026-01-01", or "2026-01-01 to 2026-03-31"'
      return
    }
    customError = ''
    onchange(result)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleCustomCommit()
  }
</script>

<div class="wrapper">
  <div class="controls">
    <select
      class="preset-select"
      value={selectedPreset}
      onchange={(e) => handlePresetChange((e.currentTarget as HTMLSelectElement).value as Preset)}
    >
      <option value="day">Past 1 day</option>
      <option value="week">Past 1 week</option>
      <option value="month">Past 1 month</option>
      <option value="3months">Past 3 months</option>
      <option value="custom">Custom...</option>
    </select>

    {#if showCustomInput}
      <input
        class="custom-input"
        type="text"
        placeholder="e.g. 90d, 2026-01-01, 2026-01-01 to 2026-03-31"
        bind:value={customInput}
        onblur={handleCustomCommit}
        onkeydown={handleKeydown}
      />
    {/if}
  </div>

  {#if customError}
    <span class="error">{customError}</span>
  {/if}
</div>

<style>
  .wrapper {
    display: flex;
    flex-direction: column;
    gap: calc(var(--sp-xs) / 2); /* 4px — half the base unit, no token for this */
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .preset-select {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    height: 22px;
    padding: 0 var(--sp-xs);
    cursor: pointer;
    outline: none;
    transition: outline var(--duration-fast) var(--ease);
  }

  .preset-select:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  .custom-input {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 2px var(--sp-xs);
    height: 22px;
    width: 280px;
    outline: none;
    transition: outline var(--duration-fast) var(--ease);
  }

  .custom-input:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  .error {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-danger);
  }
</style>
