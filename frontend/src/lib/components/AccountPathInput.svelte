<script lang="ts">
  import { createAccount } from "$lib/api";

  interface Account {
    id: string;
    path: string;
  }

  interface Props {
    accounts: Account[];
    value: string; // bound account ID; empty string = nothing selected
    placeholder?: string;
    oncreate?: (account: Account) => void;
  }

  let {
    accounts,
    value = $bindable(""),
    placeholder = "Type an account path…",
    oncreate,
  }: Props = $props();

  // The text the user sees / types in the input field.
  // Initialised from the currently-selected account's path (if any).
  let inputText = $state(accounts.find((a) => a.id === value)?.path ?? "");
  let open = $state(false);
  let activeIndex = $state(0);
  let creating = $state(false);

  // Keep inputText in sync when value changes externally.
  // Do NOT read inputText here — that would make it a dependency and
  // cause the effect to reset the field on every keystroke.
  $effect(() => {
    const match = accounts.find((a) => a.id === value);
    if (match) {
      inputText = match.path;
    }
  });

  // --- Filtered options ---
  // An option is either an existing account or a synthetic "create" entry.
  type ExistingOption = { kind: "existing"; account: Account };
  type CreateOption = { kind: "create"; path: string };
  type Option = ExistingOption | CreateOption;

  let options = $derived.by<Option[]>(() => {
    const needle = inputText.trim().toLowerCase();

    const matched: ExistingOption[] = accounts
      .filter((a) => a.path.toLowerCase().includes(needle))
      .map((a) => ({ kind: "existing", account: a }));

    const exactMatch = accounts.some((a) => a.path.toLowerCase() === needle);
    const showCreate = needle.length > 0 && !exactMatch;

    return showCreate
      ? [...matched, { kind: "create", path: inputText.trim() }]
      : matched;
  });

  // Clamp activeIndex whenever options list changes.
  $effect(() => {
    if (activeIndex >= options.length) activeIndex = 0;
  });

  // --- Input handlers ---

  function handleInput() {
    open = true;
    activeIndex = 0;
  }

  function handleFocus() {
    open = true;
  }

  function handleBlur() {
    setTimeout(() => {
      open = false;
      // If what's in the box doesn't match any account, revert to the
      // currently-selected account's path (or empty if nothing selected).
      const selected = accounts.find((a) => a.id === value);
      const exact = accounts.some(
        (a) => a.path.toLowerCase() === inputText.trim().toLowerCase(),
      );
      if (!exact) {
        inputText = selected?.path ?? "";
      }
    }, 150);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % options.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + options.length) % options.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectOption(activeIndex);
    } else if (e.key === "Escape") {
      open = false;
      const selected = accounts.find((a) => a.id === value);
      inputText = selected?.path ?? "";
    }
  }

  // --- Selection / creation ---

  async function selectOption(index: number) {
    const opt = options[index];
    if (!opt) return;

    if (opt.kind === "existing") {
      value = opt.account.id;
      inputText = opt.account.path;
      open = false;
    } else {
      if (creating) return;
      creating = true;
      try {
        const newAccount = await createAccount({ path: opt.path });
        value = newAccount.id;
        inputText = newAccount.path;
        oncreate?.(newAccount);
      } finally {
        creating = false;
        open = false;
      }
    }
  }
</script>

<div class="wrapper">
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
  />

  {#if open && options.length > 0}
    <ul class="dropdown" role="listbox">
      {#each options as option, i}
        <li
          class="option"
          class:active={i === activeIndex}
          class:create={option.kind === "create"}
          role="option"
          aria-selected={i === activeIndex}
          onmousedown={() => selectOption(i)}
          onmousemove={() => {
            activeIndex = i;
          }}
        >
          {#if option.kind === "existing"}
            {option.account.path}
          {:else}
            Press Enter to create '{option.path}'
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .wrapper {
    position: relative;
    width: 100%;
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
    background: var(--color-accent-mid);
    color: var(--color-text-on-dark);
  }

  .option.create {
    color: var(--color-text-muted);
    font-style: italic;
    border-top: 1px solid var(--color-bevel-mid);
  }

  .option.create.active {
    background: var(--color-accent);
    color: var(--color-accent-text);
  }
</style>
