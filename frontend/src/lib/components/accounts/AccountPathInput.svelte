<script lang="ts">
  import { untrack } from 'svelte'
  import { createAccount } from '$lib/api'

  interface Account {
    id: string
    path: string
  }

  interface Props {
    accounts: Account[]
    value: string // bound account ID (default) or path string (when searchOnly=true)
    placeholder?: string
    searchOnly?: boolean // path-string mode: no create option, no revert-on-blur
    oncreate?: (account: Account) => void
    oncommit?: (accountId: string) => void // fires after any selection (existing or new)
  }

  let {
    accounts,
    value = $bindable(''),
    placeholder = 'Type an account path…',
    searchOnly = false,
    oncreate,
    oncommit,
  }: Props = $props()

  // The text the user sees / types in the input field.
  // In default mode: initialised from the currently-selected account's path.
  // In searchOnly mode: value IS the path string, so use it directly.
  // Unique ID for the listbox so aria-controls can reference it
  const listboxId = `account-path-listbox-${Math.random().toString(36).slice(2, 7)}`

  let inputText = $state(
    untrack(() =>
      searchOnly ? value : (accounts.find((a) => a.id === value)?.path ?? ''),
    ),
  )
  let filterText = $state('')
  let open = $state(false)
  let activeIndex = $state(0)
  let creating = $state(false)

  // Returns the text up to and including the last colon, or the full text
  // if there is no colon. Used to seed filterText on focus so that sibling
  // accounts at the same hierarchy level are shown immediately.
  function prefixUpToLastColon(text: string): string {
    const i = text.lastIndexOf(':')
    return i >= 0 ? text.slice(0, i + 1) : text
  }

  // Subsequence fuzzy match: returns true if every character of needle
  // appears in haystack in order (not necessarily consecutively).
  // e.g. "expenses:veg" matches "expenses:groceries:veg"
  function fuzzyMatch(haystack: string, needle: string): boolean {
    let hi = 0,
      ni = 0
    while (hi < haystack.length && ni < needle.length) {
      if (haystack[hi] === needle[ni]) ni++
      hi++
    }
    return ni === needle.length
  }

  // Keep inputText in sync when value changes externally.
  // Do NOT read inputText here — that would make it a dependency and
  // cause the effect to reset the field on every keystroke.
  $effect(() => {
    if (searchOnly) {
      inputText = value
    } else {
      const match = accounts.find((a) => a.id === value)
      if (match) inputText = match.path
    }
  })

  // --- Filtered options ---
  // An option is either an existing account or a synthetic "create" entry.
  type ExistingOption = { kind: 'existing'; account: Account }
  type CreateOption = { kind: 'create'; path: string }
  type Option = ExistingOption | CreateOption

  let options = $derived.by<Option[]>(() => {
    // Filter by filterText (prefix on focus, full text while typing).
    const needle = filterText.trim().toLowerCase()

    const matched: ExistingOption[] = accounts
      .filter((a) => fuzzyMatch(a.path.toLowerCase(), needle))
      .map((a) => ({ kind: 'existing', account: a }))

    // Create option is based on the full inputText, not the filter prefix.
    const exactMatch = accounts.some(
      (a) => a.path.toLowerCase() === inputText.trim().toLowerCase(),
    )
    const showCreate = !searchOnly && inputText.trim().length > 0 && !exactMatch

    return showCreate
      ? [...matched, { kind: 'create', path: inputText.trim() }]
      : matched
  })

  // Clamp activeIndex whenever options list changes.
  $effect(() => {
    if (activeIndex >= options.length) activeIndex = 0
  })

  // --- Input handlers ---

  function handleInput() {
    filterText = inputText
    open = true
    activeIndex = 0
  }

  function handleFocus() {
    filterText = prefixUpToLastColon(inputText)
    open = true
  }

  function handleBlur() {
    setTimeout(() => {
      open = false
      if (searchOnly) {
        // Commit whatever is in the box as the path filter (partial paths are valid).
        value = inputText.trim()
        oncommit?.(value)
      } else {
        // Revert to the currently-selected account's path if no exact match.
        const selected = accounts.find((a) => a.id === value)
        const exact = accounts.some(
          (a) => a.path.toLowerCase() === inputText.trim().toLowerCase(),
        )
        if (!exact) inputText = selected?.path ?? ''
      }
    }, 150)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIndex = (activeIndex + 1) % options.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIndex = (activeIndex - 1 + options.length) % options.length
    } else if (e.key === 'Enter') {
      e.preventDefault()
      selectOption(activeIndex)
    } else if (e.key === 'Escape') {
      open = false
      inputText = searchOnly
        ? value
        : (accounts.find((a) => a.id === value)?.path ?? '')
    }
  }

  // --- Selection / creation ---

  async function selectOption(index: number) {
    const opt = options[index]
    if (!opt) return

    if (opt.kind === 'existing') {
      value = searchOnly ? opt.account.path : opt.account.id
      inputText = opt.account.path
      open = false
      oncommit?.(value)
    } else {
      if (creating) return
      creating = true
      try {
        const newAccount = await createAccount({ path: opt.path })
        value = newAccount.id
        inputText = newAccount.path
        oncreate?.(newAccount)
        oncommit?.(value)
      } finally {
        creating = false
        open = false
      }
    }
  }
</script>

{#if open}
  <div class="backdrop"></div>
{/if}

<div class="wrapper" class:elevated={open}>
  <input
    type="text"
    class="path-input"
    bind:value={inputText}
    {placeholder}
    disabled={creating}
    oninput={handleInput}
    onfocus={handleFocus}
    onblur={handleBlur}
    onkeydown={handleKeydown}
    autocomplete="off"
    spellcheck={false}
    role="combobox"
    aria-expanded={open}
    aria-autocomplete="list"
    aria-haspopup="listbox"
    aria-controls={listboxId}
  />

  {#if open && options.length > 0}
    <ul id={listboxId} class="dropdown" role="listbox">
      {#each options as option, i}
        <li
          class="option"
          class:active={i === activeIndex}
          class:create={option.kind === 'create'}
          role="option"
          aria-selected={i === activeIndex}
          onmousedown={() => selectOption(i)}
          onmousemove={() => {
            activeIndex = i
          }}
        >
          {#if option.kind === 'existing'}
            {option.account.path}
          {:else}
            Create new account '{option.path}'
          {/if}
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
    background: rgba(0, 0, 0, 0.25);
  }

  .wrapper {
    position: relative;
    width: 100%;
  }

  .wrapper.elevated {
    z-index: 51;
  }

  .path-input {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 2px var(--sp-xs);
    height: 22px;
    outline: none;
    transition: outline var(--duration-fast) var(--ease);
  }

  .path-input:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  .path-input:disabled {
    color: var(--color-text-disabled);
    cursor: wait;
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 100;
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--color-window-inset);
    box-shadow:
      var(--shadow-window),
      inset 0 0 0 1px var(--color-bevel-dark);
    max-height: 180px;
    overflow-y: auto;
  }

  .option {
    padding: 2px var(--sp-xs);
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    color: var(--color-text);
    cursor: default;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .option.active {
    background: var(--color-dropdown-active);
    color: var(--color-text-on-dark);
  }

  .option.create {
    color: var(--color-text-muted);
    font-style: italic;
    border-top: 1px solid var(--color-bevel-mid);
  }

  .option.create.active {
    background: var(--color-dropdown-active);
    color: var(--color-accent-text);
  }
</style>
