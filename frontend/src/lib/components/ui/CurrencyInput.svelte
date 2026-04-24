<script lang="ts">
  import { SUPPORTED_CURRENCIES } from "$lib/currency"
  import CurrencyPill from "./CurrencyPill.svelte"

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

  let filtered = $derived(
    SUPPORTED_CURRENCIES.filter((c) =>
      c.startsWith(inputText.trim().toUpperCase()),
    ),
  )

  $effect(() => {
    if (activeIndex >= filtered.length) activeIndex = 0
  })

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
      } else {
        inputText = value ?? ""
      }
    }, 150)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      activeIndex = (activeIndex + 1) % filtered.length
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      activeIndex = (activeIndex - 1 + filtered.length) % filtered.length
    } else if (e.key === "Enter") {
      e.preventDefault()
      selectIndex(activeIndex)
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
  }
</script>

{#if open}
  <div class="backdrop"></div>
{/if}

<div class="wrapper" class:elevated={open} {style}>
  {#if showPill}
    <!-- Natural display: just the pill, no input chrome -->
    <!-- Hidden zero-size input stays in DOM so focus() works -->
    <input
      bind:this={inputEl}
      {id}
      type="text"
      class="ghost-input"
      bind:value={inputText}
      autocomplete="off"
      tabindex="-1"
      aria-hidden="true"
      onfocus={handleFocus}
      onblur={handleBlur}
      onkeydown={handleKeydown}
    />
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pill-display" onclick={() => { inputText = ""; inputEl?.focus() }}>
      <CurrencyPill code={value} />
    </div>
  {:else}
    <input
      bind:this={inputEl}
      {id}
      type="text"
      class="currency-input"
      bind:value={inputText}
      {placeholder}
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
  {/if}

  {#if open && filtered.length > 0}
    <ul id={listboxId} class="dropdown" role="listbox">
      {#each filtered as code, i}
        <li
          class="option"
          class:active={i === activeIndex}
          role="option"
          aria-selected={i === activeIndex}
          onmousedown={() => selectIndex(i)}
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

  .currency-input:focus {
    border-color: var(--color-accent-mid);
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.08),
      0 0 0 2px var(--color-accent-light);
  }

  .ghost-input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .pill-display {
    display: inline-flex;
    align-items: center;
    cursor: text;
  }

  .pill-display:hover :global(.pill) {
    outline: 2px solid var(--color-accent-light);
    outline-offset: 1px;
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
    color: #ffffff;
  }
</style>
