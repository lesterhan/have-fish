<script lang="ts">
  import { untrack } from 'svelte'
  import { updateAccount, type Account, type StoredAccountType, type AccountType } from '$lib/api'
  import Icon from '../ui/Icon.svelte'
  import GradientButton from '../ui/GradientButton.svelte'
  import TextInput from '../ui/TextInput.svelte'
  import Select from '../ui/Select.svelte'

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

  // --- hledger account type override ---
  // The stored override (or '' for "Auto", which falls back to path inference). Saves on
  // change. Order matches hledger's: Asset, Cash, Liability, Equity, Income(=Revenue),
  // Expense, Conversion. Cash + Conversion are override-only — inference never yields them.
  const TYPE_LABELS: Record<StoredAccountType, string> = {
    asset: 'Asset',
    cash: 'Cash',
    liability: 'Liability',
    equity: 'Equity',
    income: 'Income',
    expense: 'Expense',
    conversion: 'Conversion',
  }
  const TYPE_OPTIONS = Object.keys(TYPE_LABELS) as StoredAccountType[]

  let typeValue = $state(untrack(() => account.type ?? ''))
  let savingType = $state(false)

  $effect(() => {
    typeValue = account.type ?? ''
  })

  // The label for the "Auto" option's inferred result, shown so the user knows what inference
  // would pick. Atypical roots infer to nothing → "unclassified".
  const inferredLabel = $derived(
    account.inferredType ? TYPE_LABELS[account.inferredType as AccountType] : 'unclassified',
  )

  async function saveType() {
    if (savingType) return
    savingType = true
    try {
      const next = typeValue === '' ? null : (typeValue as StoredAccountType)
      const updated = await updateAccount(account.id, { type: next })
      onupdated(updated)
    } finally {
      savingType = false
    }
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
      <label class="setting-label" for="account-type">Type</label>
      <div class="setting-control">
        <Select
          id="account-type"
          bind:value={typeValue}
          onchange={saveType}
          disabled={savingType}
          title="hledger account type used on export. Auto infers from the path."
        >
          <option value="">Auto (inferred: {inferredLabel})</option>
          {#each TYPE_OPTIONS as t}
            <option value={t}>{TYPE_LABELS[t]}</option>
          {/each}
        </Select>
        {#if typeValue !== ''}
          <span class="override-badge" title="Overriding the inferred type">override</span>
        {/if}
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

  .override-badge {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--color-accent-mid);
    border: 1px solid var(--color-accent-light);
    border-radius: var(--radius-sm);
    padding: 1px 4px;
    white-space: nowrap;
  }
</style>
