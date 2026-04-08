<script lang="ts">
  import { updateAccount, type Account } from '$lib/api'
  import Icon from '../ui/Icon.svelte'

  interface Props {
    account: Account
    hidden: boolean
    onupdated: (account: Account) => void
    ontogglehidden: () => void
  }

  let { account, hidden, onupdated, ontogglehidden }: Props = $props()

  let nameValue = $state(account.name ?? '')
  let saving = $state(false)

  $effect(() => {
    nameValue = account.name ?? ''
  })

  async function save() {
    if (saving) return
    saving = true
    try {
      const updated = await updateAccount(account.id, {
        name: nameValue.trim() || null,
      })
      onupdated(updated)
    } finally {
      saving = false
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') save()
    else if (e.key === 'Escape') nameValue = account.name ?? ''
  }
</script>

<div class="settings-panel">
  <div class="settings-header">
    <span class="settings-title">Account Settings</span>
  </div>
  <div class="settings-body">
    <div class="setting-row">
      <label class="setting-label" for="account-name">Display name</label>
      <div class="setting-control">
        <input
          id="account-name"
          class="name-input"
          bind:value={nameValue}
          placeholder={account.path}
          disabled={saving}
          onkeydown={handleKeydown}
        />
        <button class="save-btn" onclick={save} disabled={saving}>
          <Icon name="floppy" size={12} />{saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>

    <div class="setting-row">
      <label class="setting-label">Sidebar visibility</label>
      <div class="setting-control">
        <button
          class="action-btn"
          class:active={hidden}
          onclick={ontogglehidden}
        >
          {hidden ? 'Hidden — click to show' : 'Visible — click to hide'}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .settings-panel {
    margin-bottom: var(--sp-xl);
    box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.3);
  }

  .settings-header {
    padding: 3px var(--sp-sm);
    background: linear-gradient(
      to right,
      var(--color-panel-header-from),
      var(--color-panel-header-to)
    );
  }

  .settings-title {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-panel-header-text);
  }

  .settings-body {
    background: var(--color-window);
    box-shadow: var(--shadow-sunken);
    padding: var(--sp-md) var(--sp-lg);
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
  }

  .setting-row {
    display: flex;
    align-items: center;
    gap: var(--sp-lg);
  }

  .setting-label {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    width: 10rem;
    flex-shrink: 0;
  }

  .setting-control {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .name-input {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    padding: 2px var(--sp-xs);
    width: 20rem;
    outline: none;
    box-shadow: var(--shadow-sunken);
  }

  .name-input:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .save-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-xs);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-window);
    border: 1px solid var(--color-border);
    padding: 2px var(--sp-sm);
    cursor: pointer;
    box-shadow: var(--shadow-raised);
    transition: box-shadow var(--duration-fast) var(--ease);
  }

  .save-btn:hover {
    box-shadow: var(--shadow-raised);
    filter: brightness(0.95);
  }

  .save-btn:active {
    box-shadow: var(--shadow-sunken);
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .action-btn {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    background: var(--color-window);
    border: 1px solid var(--color-border);
    padding: 2px var(--sp-sm);
    cursor: pointer;
    box-shadow: var(--shadow-raised);
    transition:
      box-shadow var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }

  .action-btn:hover {
    color: var(--color-text);
  }

  .action-btn:active {
    box-shadow: var(--shadow-sunken);
  }

  .action-btn.active {
    color: var(--color-accent-mid);
  }
</style>
