<script lang="ts">
  import { untrack } from 'svelte'
  import { toISODate, parseCustomDateRange } from '$lib/date'

  export type DateRange = { from: string; to: string }

  type PresetUnit = 'days' | 'months'
  type Preset = { label: string; amount: number; unit: PresetUnit }

  const PRESETS: Preset[] = [
    { label: 'Past 7 days', amount: 7, unit: 'days' },
    { label: '2 weeks', amount: 14, unit: 'days' },
    { label: '30d', amount: 30, unit: 'days' },
    { label: '3 months', amount: 3, unit: 'months' },
    { label: '6mo', amount: 6, unit: 'months' },
  ]

  interface Props {
    value: DateRange
    onchange: (range: DateRange) => void
  }

  let { value, onchange }: Props = $props()

  function resolvePreset(preset: Preset, today = new Date()): DateRange {
    const from = new Date(today)
    if (preset.unit === 'months') {
      from.setMonth(today.getMonth() - preset.amount)
    } else {
      from.setDate(today.getDate() - preset.amount)
    }
    return { from: toISODate(from), to: toISODate(today) }
  }

  // Return the human-readable label for a range, or the ISO range string if
  // it doesn't match any preset.
  function rangeToText(v: DateRange): string {
    for (const p of PRESETS) {
      const r = resolvePreset(p)
      if (r.from === v.from && r.to === v.to) return p.label
    }
    return `${v.from} to ${v.to}`
  }

  let isOpen = $state(false)
  let inputText = $state(untrack(() => rangeToText(value)))
  let error = $state('')
  let inputEl = $state<HTMLInputElement | undefined>(undefined)
  let wrapperEl = $state<HTMLDivElement | undefined>(undefined)

  // Keep display text in sync when value changes externally (e.g. FilterPanel Reset).
  $effect(() => {
    if (!isOpen) inputText = rangeToText(value)
  })

  function open() {
    if (isOpen) return
    isOpen = true
    setTimeout(() => inputEl?.select(), 0)
  }

  function close() {
    if (!isOpen) return
    isOpen = false
    error = ''
    inputText = rangeToText(value)
  }

  function applyRange(range: DateRange, displayText: string) {
    inputText = displayText
    isOpen = false
    error = ''
    onchange(range)
  }

  function commit() {
    const trimmed = inputText.trim()

    // Allow typing a preset label directly
    const presetMatch = PRESETS.find(
      (p) => p.label.toLowerCase() === trimmed.toLowerCase(),
    )
    if (presetMatch) {
      applyRange(resolvePreset(presetMatch), presetMatch.label)
      return
    }

    const result = parseCustomDateRange(trimmed)
    if (result === null) {
      error =
        'Could not parse — try "90d", "2026-01-01", or "2026-01-01 to 2026-03-31"'
      return
    }
    // rangeToText will show a preset label if the parsed range happens to match one
    applyRange(result, rangeToText(result))
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    }
    if (e.key === 'Escape') close()
  }

  // Use mousedown (not click) so we can close before any blur/focus reshuffling.
  function handleOutsideMousedown(e: MouseEvent) {
    if (!isOpen) return
    if (wrapperEl && !wrapperEl.contains(e.target as Node)) close()
  }

  $effect(() => {
    document.addEventListener('mousedown', handleOutsideMousedown)
    return () =>
      document.removeEventListener('mousedown', handleOutsideMousedown)
  })
</script>

<div class="wrapper" bind:this={wrapperEl}>
  <input
    class="range-input"
    type="text"
    bind:value={inputText}
    bind:this={inputEl}
    onfocus={open}
    onkeydown={handleKeydown}
  />

  {#if isOpen}
    <div class="dropdown" role="listbox">
      {#each PRESETS as preset}
        <button
          class="preset-option"
          class:active={inputText === preset.label}
          role="option"
          aria-selected={inputText === preset.label}
          onmousedown={(e) => {
            // Prevent input blur before applyRange closes the dropdown
            e.preventDefault()
            applyRange(resolvePreset(preset), preset.label)
          }}>{preset.label}</button
        >
      {/each}
    </div>
  {/if}

  {#if error}
    <span class="error">{error}</span>
  {/if}
</div>

<style>
  .wrapper {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    gap: calc(var(--sp-xs) / 2);
  }

  .range-input {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 2px var(--sp-xs);
    height: 22px;
    width: 120px;
    outline: none;
    transition: outline var(--duration-fast) var(--ease);
    cursor: text;
  }

  .range-input:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    z-index: 100;
    min-width: 100%;
    background: var(--color-window);
    border: 1px solid var(--color-rule);
    box-shadow: var(--shadow-window);
  }

  .preset-option {
    display: block;
    width: 100%;
    padding: 3px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text);
    background: transparent;
    border: none;
    border-left: 2px solid transparent;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    box-sizing: border-box;
    transition:
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }

  .preset-option:hover,
  .preset-option.active {
    background: var(--color-accent-chip-bg);
    color: var(--color-accent);
    border-left-color: var(--color-accent);
  }

  .error {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-danger);
    white-space: nowrap;
  }
</style>
