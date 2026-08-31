<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchAccounts } from '$lib/api'
  import type { Account } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import CurrencyInput from '$lib/components/ui/CurrencyInput.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import Modal from '$lib/components/ui/Modal.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { signOut, useSession, authClient } from '$lib/auth'
  import { goto } from '$app/navigation'
  import { tick } from 'svelte'
  import { confetti } from '$lib/confetti.svelte'
  import { toast } from '$lib/toast.svelte'
  import TooltipIcon from '$lib/components/ui/TooltipIcon.svelte'

  const session = useSession()

  let editingName = $state(false)
  let nameInput = $state('')

  let displayName = $derived(
    $session.data?.user.name !== $session.data?.user.email
      ? ($session.data?.user.name ?? '')
      : '',
  )

  async function startEditName() {
    nameInput = $session.data?.user.name ?? ''
    editingName = true
    await tick()
    document.querySelector<HTMLInputElement>('.name-section input')?.focus()
  }

  async function handleSaveName() {
    const trimmed = nameInput.trim()
    if (!trimmed) return
    const result = await authClient.updateUser({ name: trimmed })
    if (result.error) {
      toast.show('Failed to save display name')
    } else {
      toast.show('Display name saved')
      editingName = false
    }
  }

  function cancelEditName() {
    editingName = false
  }

  async function handleSignOut() {
    await signOut()
    goto('/login')
  }

  let offsetAccountId = $state('')
  let conversionAccountId = $state('')
  let adjustmentsAccountId = $state('')
  let preferredCurrency = $state('CAD')
  // Still fetched, but only to feed the three account pickers below — the flat list of every
  // path this page used to render alongside them is the Accounts page's job now.
  let accounts = $state<Account[]>([])

  onMount(async () => {
    const [accts, settings] = await Promise.all([
      fetchAccounts(),
      settingsStore.load(),
    ])
    accounts = accts
    offsetAccountId = settings.defaultOffsetAccountId ?? ''
    conversionAccountId = settings.defaultConversionAccountId ?? ''
    adjustmentsAccountId = settings.defaultAdjustmentsAccountId ?? ''
    preferredCurrency = settings.preferredCurrency ?? 'CAD'
  })

  const defaultLabels: Record<string, string> = {
    defaultOffsetAccountId: 'Uncategorized account',
    defaultConversionAccountId: 'Conversion account',
    defaultAdjustmentsAccountId: 'Adjustments account',
  }

  async function handleDefaultChange(
    field:
      | 'defaultOffsetAccountId'
      | 'defaultConversionAccountId'
      | 'defaultAdjustmentsAccountId',
    accountId: string,
  ) {
    await settingsStore.update({ [field]: accountId || null })
    toast.show(`${defaultLabels[field]} saved`)
  }

  const rootPathLabels: Record<string, string> = {
    defaultAssetsRootPath: 'Assets root path',
    defaultLiabilitiesRootPath: 'Liabilities root path',
    defaultExpensesRootPath: 'Expenses root path',
    defaultEquityRootPath: 'Equity root path',
  }

  async function handleRootPathChange(
    field:
      | 'defaultAssetsRootPath'
      | 'defaultLiabilitiesRootPath'
      | 'defaultExpensesRootPath'
      | 'defaultEquityRootPath',
    value: string,
  ) {
    if (!value.trim()) return
    await settingsStore.update({ [field]: value.trim() })
    toast.show(`${rootPathLabels[field]} saved`)
  }

  let showDeleteConfirm = $state(false)

  async function handleDeleteUser() {
    await authClient.deleteUser()
    goto('/login')
  }
</script>

<div class="page">
  <!-- User -->
  <div class="settings-section section-user">
    <div class="section-bar">
      <button
        class="secret-btn"
        onclick={() => {
          toast.show('年年有鱼 · Year Year Have Fish')
          confetti.trigger()
        }}
        aria-label="Year Year Have Fish">🧧</button
      >
      {#if $session.data}
        <span class="user-email">{$session.data.user.email}</span>
        <div class="name-section">
          {#if editingName}
            <TextInput
              bind:value={nameInput}
              placeholder="Display name"
              spellcheck={false}
              style="flex: 1; min-width: 0; height: 20px; font-size: 11px"
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === 'Enter') handleSaveName()
                if (e.key === 'Escape') cancelEditName()
              }}
            />
            <GradientButton square onclick={handleSaveName} tooltip="Save name">
              <Icon name="check" size={10} />
            </GradientButton>
            <GradientButton square onclick={cancelEditName} tooltip="Cancel">
              <Icon name="close" size={10} />
            </GradientButton>
          {:else}
            <span class="user-display-name" class:placeholder={!displayName}>
              [ {displayName || "what's your name…"} ]
            </span>
            <GradientButton
              square
              onclick={startEditName}
              tooltip="Edit display name"
            >
              <Icon name="edit-txn" size={10} />
            </GradientButton>
          {/if}
        </div>
      {/if}
      <GradientButton onclick={handleSignOut}>Sign out</GradientButton>
    </div>
  </div>

  <!-- Account defaults -->
  <div class="settings-section section-defaults">
    <div class="section-bar">
      <span class="section-bar-title">Account Defaults</span>
      <!-- These three are pointers *at* accounts, so they stay here; the accounts themselves
           moved. The link is where the old "Manage" button was, for the muscle memory. -->
      <GradientButton
        onclick={() => goto('/accounts')}
        tooltip="Add, rename, pin and hide accounts and categories"
      >
        Accounts
      </GradientButton>
    </div>
    <div class="section-body">
      <div class="setting-row">
        <span class="setting-label">
          Uncategorized
          <TooltipIcon
            label="Imported transactions with no matched category will use this account."
          />
        </span>
        <AccountPathInput
          {accounts}
          bind:value={offsetAccountId}
          placeholder="liabilities:offset"
          oncommit={(id) => handleDefaultChange('defaultOffsetAccountId', id)}
          oncreate={(a) => {
            accounts = [...accounts, a]
          }}
        />
      </div>
      <div class="setting-row">
        <span class="setting-label">
          Conversion balance
          <TooltipIcon
            label="Equity account used to balance cross-currency transfers. Required for multi-currency imports."
          />
        </span>
        <AccountPathInput
          {accounts}
          bind:value={conversionAccountId}
          placeholder="equity:conversions"
          oncommit={(id) =>
            handleDefaultChange('defaultConversionAccountId', id)}
          oncreate={(a) => {
            accounts = [...accounts, a]
          }}
        />
      </div>
      <div class="setting-row">
        <span class="setting-label">
          Adjustments
          <TooltipIcon
            label="Equity account used as the offset when posting a reconciliation adjustment."
          />
        </span>
        <AccountPathInput
          {accounts}
          bind:value={adjustmentsAccountId}
          placeholder="equity:adjustments"
          oncommit={(id) =>
            handleDefaultChange('defaultAdjustmentsAccountId', id)}
          oncreate={(a) => {
            accounts = [...accounts, a]
          }}
        />
      </div>
      <div class="setting-row">
        <label class="setting-label" for="preferred-currency">
          Preferred currency
          <TooltipIcon
            label="Your home currency. Used for FX conversion displays."
          />
        </label>
        <CurrencyInput
          id="preferred-currency"
          bind:value={preferredCurrency}
          style="width: 7rem"
          oncommit={async () => {
            await settingsStore.update({ preferredCurrency })
            toast.show('Preferred currency saved')
          }}
        />
      </div>
    </div>
  </div>

  <!-- Root paths -->
  <div class="settings-section section-roots">
    <div class="section-bar">
      <span class="section-bar-title">Root Paths</span>
    </div>
    <div class="section-body">
      <div class="setting-row">
        <label class="setting-label" for="assets-root-path">
          Assets
          <TooltipIcon
            label="Root prefix for asset accounts (e.g. 'assets' → 'assets:bank:chequing')."
          />
        </label>
        <TextInput
          id="assets-root-path"
          value={settingsStore.value?.defaultAssetsRootPath ?? 'assets'}
          onblur={(e) =>
            handleRootPathChange(
              'defaultAssetsRootPath',
              (e.currentTarget as HTMLInputElement).value,
            )}
          placeholder="assets"
          spellcheck={false}
          style="width: 100%; box-sizing: border-box"
        />
      </div>
      <div class="setting-row">
        <label class="setting-label" for="liabilities-root-path">
          Liabilities
          <TooltipIcon
            label="Root prefix for liability accounts (e.g. 'liabilities' → 'liabilities:creditcard')."
          />
        </label>
        <TextInput
          id="liabilities-root-path"
          value={settingsStore.value?.defaultLiabilitiesRootPath ??
            'liabilities'}
          onblur={(e) =>
            handleRootPathChange(
              'defaultLiabilitiesRootPath',
              (e.currentTarget as HTMLInputElement).value,
            )}
          placeholder="liabilities"
          spellcheck={false}
          style="width: 100%; box-sizing: border-box"
        />
      </div>
      <div class="setting-row">
        <label class="setting-label" for="expenses-root-path">
          Expenses
          <TooltipIcon
            label="Root prefix for expense accounts. Used to filter spending reports."
          />
        </label>
        <TextInput
          id="expenses-root-path"
          value={settingsStore.value?.defaultExpensesRootPath ?? 'expenses'}
          onblur={(e) =>
            handleRootPathChange(
              'defaultExpensesRootPath',
              (e.currentTarget as HTMLInputElement).value,
            )}
          placeholder="expenses"
          spellcheck={false}
          style="width: 100%; box-sizing: border-box"
        />
      </div>
      <div class="setting-row">
        <label class="setting-label" for="equity-root-path">
          Equity
          <TooltipIcon
            label="Root prefix for equity accounts. (e.g. 'equity' → 'equity:investments')."
          />
        </label>
        <TextInput
          id="equity-root-path"
          value={settingsStore.value?.defaultEquityRootPath ?? 'equity'}
          onblur={(e) =>
            handleRootPathChange(
              'defaultEquityRootPath',
              (e.currentTarget as HTMLInputElement).value,
            )}
          placeholder="equity"
          spellcheck={false}
          style="width: 100%; box-sizing: border-box"
        />
      </div>
    </div>
  </div>

  <!-- Danger zone -->
  <div class="settings-section section-danger">
    <div class="section-bar danger-bar">
      <span class="section-bar-title">Danger Zone</span>
    </div>
    <div class="section-body">
      <div class="setting-row danger-row">
        <div class="danger-info">
          <span class="danger-title">Delete my account</span>
          <span class="danger-desc"
            >Permanently removes your account and all associated data. This
            cannot be undone.</span
          >
        </div>
        <GradientButton
          variant="warning"
          active
          onclick={() => (showDeleteConfirm = true)}
        >
          Delete account
        </GradientButton>
      </div>
    </div>
  </div>
</div>

<Modal title="Delete account" bind:open={showDeleteConfirm}>
  <div class="delete-modal">
    <p>
      This will permanently delete your user account and all data. This cannot
      be undone.
    </p>
    <div class="delete-actions">
      <GradientButton onclick={() => (showDeleteConfirm = false)}
        >Cancel</GradientButton
      >
      <GradientButton variant="warning" active onclick={handleDeleteUser}
        >Delete account</GradientButton
      >
    </div>
  </div>
</Modal>

<style>
  /* --- Layout --- *
     One column since the accounts panel left. It was the only thing that needed its own
     scroll region, so the page stacks and lets the app shell scroll it like every other. */
  .page {
    display: flex;
    flex-direction: column;
    background: var(--color-window);
    min-height: 100%;
  }

  .settings-section {
    border-bottom: 1px solid var(--color-rule);
  }

  .section-danger {
    border-bottom: none;
    margin-top: auto;
  }

  @media (max-width: 640px) {
    .page {
      margin: calc(-1 * var(--sp-md));
    }
  }

  /* --- Section shell --- */
  .section-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 5px 14px;
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
    flex-shrink: 0;
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: var(--weight-semibold);
    letter-spacing: 0.6px;
    flex: 1;
  }

  .user-email {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-section-bar-fg);
    opacity: 0.75;
    flex-shrink: 0;
  }

  .name-section {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    min-width: 0;
  }

  .user-display-name {
    flex: 1;
    font-family: var(--font-mono);
    font-weight: var(--weight-semibold);
    font-size: 11px;
    color: var(--color-section-bar-fg);
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .user-display-name.placeholder {
    font-style: italic;
    opacity: 0.3;
  }

  .danger-bar {
    background: linear-gradient(180deg, #5a2020, #2a0808);
    border-top-color: #8a4040;
    border-bottom-color: #0a0202;
  }

  .section-body {
    display: flex;
    flex-direction: column;
  }

  /* --- Setting rows --- *
     Capped: with the accounts column gone these run the width of the window, and a field
     900px wide for a twenty-character path is not more usable than one at 46rem. */
  .setting-row {
    display: grid;
    max-width: 46rem;
    grid-template-columns: 10rem 1fr;
    align-items: center;
    gap: var(--sp-sm);
    padding: 7px 14px;
    border-bottom: 1px solid var(--color-rule);
  }

  .setting-row:last-child {
    border-bottom: none;
  }

  .setting-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: var(--weight-semibold);
    letter-spacing: 0.4px;
    color: var(--color-text-muted);
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  /* --- Danger row --- */
  /* The one row that keeps the full width — its button belongs at the far edge. */
  .danger-row {
    max-width: none;
    grid-template-columns: 1fr auto;
  }

  .danger-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .danger-title {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-danger);
  }

  .danger-desc {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* --- Secret button --- */
  .secret-btn {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    cursor: pointer;
    line-height: 1;
    font-size: 14px;
    flex-shrink: 0;
  }

  /* --- Delete modal --- */
  .delete-modal {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    min-width: 340px;
  }

  .delete-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-xs);
  }
</style>
