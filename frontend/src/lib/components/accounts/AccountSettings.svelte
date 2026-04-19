<script lang="ts">
  import { untrack } from 'svelte'
  import { updateAccount, type Account } from '$lib/api'
  import Icon from '../ui/Icon.svelte'
  import GradientButton from '../ui/GradientButton.svelte'
  import TextInput from '../ui/TextInput.svelte'

  interface Props {
    account: Account
    hidden: boolean
    onupdated: (account: Account) => void
    ontogglehidden: () => void
  }

  let { account, hidden, onupdated, ontogglehidden }: Props = $props()

  let nameValue = $state(untrack(() => account.name ?? ''))
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
        <TextInput
          id="account-name"
          bind:value={nameValue}
          placeholder={account.path}
          disabled={saving}
          onkeydown={handleKeydown}
          style="width: 18rem"
        />
        <GradientButton onclick={save} disabled={saving}>
          <Icon name="floppy" size={12} />{saving ? 'Saving…' : 'Save'}
        </GradientButton>
      </div>
    </div>

    <div class="setting-row">
      <span class="setting-label" id="visibility-label">Sidebar visibility</span>
      <div class="setting-control">
        <GradientButton
          active={hidden}
          onclick={ontogglehidden}
        >
          {hidden ? 'Hidden' : 'Visible'}
        </GradientButton>
      </div>
    </div>
  </div>
</div>

<style>
  .settings-panel {
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-rule);
  }

  .settings-header {
    padding: 4px 14px;
    background: var(--color-window-raised);
    border-bottom: 1px solid var(--color-rule);
  }

  .settings-title {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .settings-body {
    background: var(--color-window);
    padding: var(--sp-sm) 14px;
    display: flex;
    align-items: center;
    gap: var(--sp-xl);
  }

  .setting-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .setting-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .setting-control {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }
</style>
