<script lang="ts">
  import { SUPPORTED_CURRENCIES } from "$lib/currency"
  import CurrencyPill from "./CurrencyPill.svelte"
  import { settingsStore } from "$lib/settings.svelte"

  interface Props {
    value?: string
    id?: string
    placeholder?: string
    style?: string
    oncommit?: (value: string) => void
  }

  let {
    value = $bindable("CAD"),
    id,
    placeholder = "CAD",
    style,
    oncommit,
  }: Props = $props()

  const listboxId = `currency-listbox-${Math.random().toString(36).slice(2, 7)}`

  let inputEl: HTMLInputElement | undefined = $state()
  let inputText = $state(value ?? "")
  let open = $state(false)
  let focused = $state(false)
  let activeIndex = $state(0)

  $effect(() => {
    if (!focused) inputText = value ?? ""
  })

  let recentCurrencies = $derived(
    settingsStore.value?.preferences?.recentCurrencies ?? []
  )

  let filtered = $derived.by(() => {
    const prefix = inputText.trim().toUpperCase()
    const matches = SUPPORTED_CURRENCIES.filter((c) => c.startsWith(prefix))
    if (recentCurrencies.length === 0) return matches
    const recentSet = new Set(recentCurrencies)
    const recentsFirst = recentCurrencies.filter((c) => matches.includes(c))
    const others = matches.filter((c) => !recentSet.has(c))
    return [...recentsFirst, ...others]
  })

  $effect(() => {
    if (activeIndex >= filtered.length) activeIndex = 0
  })

  function pushRecent(code: string) {
    const current = settingsStore.value?.preferences?.recentCurrencies ?? []
    const next = [code, ...current.filter((c) => c !== code)].slice(0, 8)
    settingsStore.update({ preferences: { recentCurrencies: next } }).catch(() => {})
  }

  // Show pill overlay when not focused and value is a known currency
  let showPill = $derived(
    !focused && SUPPORTED_CURRENCIES.includes((value ?? "").toUpperCase()),
  )

  function handleFocus() {
    focused = true
    open = true
    activeIndex = 0
  }

  function handleInput() {
    open = true
    activeIndex = 0
  }

  function handleBlur() {
    setTimeout(() => {
      open = false
      focused = false
      const upper = inputText.trim().toUpperCase()
      if (SUPPORTED_CURRENCIES.includes(upper)) {
        value = upper
        oncommit?.(upper)
        pushRecent(upper)
      } else {
        inputText = value ?? ""
      }
    }, 150)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      if (open && filtered.length > 0) {
        selectIndex(activeIndex)
      } else {
        const upper = inputText.trim().toUpperCase()
        if (SUPPORTED_CURRENCIES.includes(upper)) {
          value = upper
          inputText = upper
          open = false
          oncommit?.(upper)
          pushRecent(upper)
          inputEl?.blur()
        }
      }
      return
    }
    if (!open) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      activeIndex = (activeIndex + 1) % filtered.length
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      activeIndex = (activeIndex - 1 + filtered.length) % filtered.length
    } else if (e.key === "Escape") {
      open = false
      inputText = value ?? ""
      inputEl?.blur()
    }
  }

  function selectIndex(i: number) {
    const code = filtered[i]
    if (!code) return
    value = code
    inputText = code
    open = false
    oncommit?.(code)
    pushRecent(code)
    inputEl?.blur()
  }

  function activatePill() {
    inputText = ""
    inputEl?.focus()
  }
</script>

{#if open}
  <div class="backdrop"></div>
{/if}

<div class="wrapper" class:elevated={open} {style}>
  <!--
    Single input always in DOM — avoids the unmount→blur→focus-loss loop that
    occurred when switching between ghost-input (pill mode) and currency-input
    (edit mode). The pill-overlay sits on top when not editing.
  -->
  <input
    bind:this={inputEl}
    {id}
    type="text"
    class="currency-input"
    class:pill-mode={showPill}
    bind:value={inputText}
    {placeholder}
    tabindex={showPill ? -1 : 0}
    autocomplete="off"
    spellcheck={false}
    role="combobox"
    aria-expanded={open}
    aria-autocomplete="list"
    aria-haspopup="listbox"
    aria-controls={listboxId}
    oninput={handleInput}
    onfocus={handleFocus}
    onblur={handleBlur}
    onkeydown={handleKeydown}
  />

  {#if showPill}
    <div
      class="pill-overlay"
      tabindex="0"
      role="button"
      aria-label="Edit currency {value}"
      onclick={activatePill}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          activatePill()
        }
      }}
    >
      <CurrencyPill code={value} />
    </div>
  {/if}

  {#if open && filtered.length > 0}
    <ul id={listboxId} class="dropdown" role="listbox">
      {#each filtered as code, i}
        <li
          class="option"
          class:active={i === activeIndex}
          role="option"
          aria-selected={i === activeIndex}
          onmousedown={(e) => { e.preventDefault(); selectIndex(i) }}
          onmousemove={() => {
            activeIndex = i
          }}
        >
          {code}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  .wrapper {
    position: relative;
    display: inline-block;
  }

  .wrapper.elevated {
    z-index: 51;
  }

  .currency-input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    color: var(--color-text);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
    padding: 2px var(--sp-xs);
    height: 22px;
    outline: none;
    transition:
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .currency-input.pill-mode {
    opacity: 0;
    pointer-events: none;
  }

  .currency-input:focus {
    border-color: var(--color-accent-mid);
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.08),
      0 0 0 2px var(--color-accent-light);
  }

  /* Covers the input visually when a valid currency is set and not being edited */
  .pill-overlay {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    padding: 0 2px;
    cursor: text;
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
    outline: none;
    transition:
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .pill-overlay:hover {
    border-color: var(--color-accent-mid);
  }

  .pill-overlay:focus {
    border-color: var(--color-accent-mid);
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.08),
      0 0 0 2px var(--color-accent-light);
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 100;
    list-style: none;
    margin: 1px 0 0;
    padding: 0;
    background: var(--color-window);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-window);
    max-height: 180px;
    overflow-y: auto;
    min-width: 5rem;
  }

  .option {
    padding: 3px 8px;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--color-text);
    cursor: default;
  }

  .option.active {
    background: var(--color-accent);
    color: var(--color-accent-fg);
  }
</style>
