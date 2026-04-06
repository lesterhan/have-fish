<script lang="ts">
  import { updateAccount, type Account } from '$lib/api'
  import { tooltip } from '$lib/tooltip'

  interface Props {
    account: Account
    onupdated: (account: Account) => void
    hidden?: boolean
    ontogglehidden?: () => void
  }

  let { account, onupdated, hidden = false, ontogglehidden }: Props = $props()

  let editing = $state(false)
  let inputValue = $state('')
  let saving = $state(false)
  let inputEl = $state<HTMLInputElement | undefined>(undefined)

  // Focus + select all when the input mounts.
  $effect(() => {
    if (editing) inputEl?.focus()
  })

  function startEditing() {
    inputValue = account.name ?? ''
    editing = true
  }

  // Track whether blur should save — Escape sets this to false before blur fires.
  let saveOnBlur = true

  async function save() {
    if (saving) return
    saving = true
    try {
      const name = inputValue.trim() || null
      const updated = await updateAccount(account.id, { name })
      onupdated(updated)
    } finally {
      saving = false
      editing = false
    }
  }

  function cancel() {
    editing = false
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      saveOnBlur = false
      save()
    } else if (e.key === 'Escape') {
      saveOnBlur = false
      cancel()
    }
  }

  function handleBlur() {
    if (saveOnBlur) save()
    saveOnBlur = true
  }
</script>

{#if editing}
  <div class="edit-row">
    <input
      bind:this={inputEl}
      bind:value={inputValue}
      class="name-input"
      placeholder={account.path}
      disabled={saving}
      onkeydown={handleKeydown}
      onblur={handleBlur}
      aria-label="Account name"
    />
  </div>
{:else if account.name}
  <!-- Named: clickable heading + subtle path beneath -->
  <div class="heading-row">
    <button class="name-display" use:tooltip={'Change account name'} onclick={startEditing} aria-label="Edit account name">
      <h1 class="account-title">
        {account.name}<span class="edit-hint" aria-hidden="true"> ✏️</span>
      </h1>
    </button>
    {#if ontogglehidden}
      <button
        class="hide-btn"
        class:is-hidden={hidden}
        use:tooltip={hidden ? 'Show in sidebar' : 'Hide from sidebar'}
        onclick={ontogglehidden}
        aria-label={hidden ? 'Show account in sidebar' : 'Hide account from sidebar'}
      >{hidden ? '🙈' : '👁️'}</button>
    {/if}
  </div>
  <p class="account-path">{account.path}</p>
{:else}
  <!-- Unnamed: path as heading + label button to add a name -->
  <div class="unnamed-row">
    <h1 class="account-title">{account.path}</h1>
    <button class="label-btn" use:tooltip={'Add an account name'} onclick={startEditing} aria-label="Add account name">🏷️</button>
    {#if ontogglehidden}
      <button
        class="hide-btn"
        class:is-hidden={hidden}
        use:tooltip={hidden ? 'Show in sidebar' : 'Hide from sidebar'}
        onclick={ontogglehidden}
        aria-label={hidden ? 'Show account in sidebar' : 'Hide account from sidebar'}
      >{hidden ? '🙈' : '👁️'}</button>
    {/if}
  </div>
{/if}

<style>
  /* --- Editing --- */

  .edit-row {
    display: flex;
    align-items: center;
    margin-bottom: var(--sp-lg);
  }

  .name-input {
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    font-family: var(--font-serif);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 2px var(--sp-xs);
    width: 100%;
    outline: none;
  }

  .name-input:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  /* --- Named state --- */

  .heading-row {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-xs);
  }

  .name-display {
    display: inline-block;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }

  .account-title {
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    font-family: var(--font-serif);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }

  .edit-hint {
    font-size: var(--text-base);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease);
  }

  .name-display:hover .edit-hint {
    opacity: 1;
  }

  .account-path {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-top: 2px;
    margin-bottom: var(--sp-lg);
  }

  .hide-btn {
    font-size: var(--text-base);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    opacity: 0.3;
    transition: opacity var(--duration-fast) var(--ease);
    line-height: 1;
    align-self: center;
    flex-shrink: 0;
  }

  .hide-btn:hover,
  .hide-btn.is-hidden {
    opacity: 1;
  }

  /* --- Unnamed state --- */

  .unnamed-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    margin-bottom: var(--sp-lg);
  }

  .unnamed-row .account-title {
    margin-bottom: 0;
  }

  .label-btn {
    font-size: var(--text-base);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    opacity: 0.5;
    transition: opacity var(--duration-fast) var(--ease);
    line-height: 1;
  }

  .label-btn:hover {
    opacity: 1;
  }
</style>
