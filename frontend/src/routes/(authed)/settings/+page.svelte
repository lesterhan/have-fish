<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchAccounts, createAccount, deleteAccount } from '$lib/api'
  import type { Account } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import Select from '$lib/components/ui/Select.svelte'
  import CurrencyInput from '$lib/components/ui/CurrencyInput.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import Modal from '$lib/components/ui/Modal.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { signOut, useSession, authClient } from '$lib/auth'
  import { goto } from '$app/navigation'
  import { confetti } from '$lib/confetti.svelte'
  import { toast } from '$lib/toast.svelte'
  import { tooltip } from '$lib/tooltip'
  import { scrollShadow } from '$lib/scrollShadow'

  const session = useSession()

  async function handleSignOut() {
    await signOut()
    goto('/login')
  }

  let offsetAccountId = $state('')
  let conversionAccountId = $state('')
  let adjustmentsAccountId = $state('')
  let preferredCurrency = $state('CAD')
  let accounts = $state<Account[]>([])
  let newAccountPath = $state('')

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

  async function handleCreateAccount() {
    if (!newAccountPath.trim()) return
    const created = await createAccount({ path: newAccountPath.trim() })
    accounts = [...accounts, created]
    newAccountPath = ''
  }

  async function handleDeleteAccount(id: string) {
    await deleteAccount(id)
    accounts = accounts.filter((a: { id: string }) => a.id !== id)
  }

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

  let sortedAccounts = $derived(
    [...accounts].sort((a, b) => a.path.localeCompare(b.path)),
  )
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
      {/if}
      <GradientButton onclick={handleSignOut}>Sign out</GradientButton>
    </div>
  </div>

  <!-- Account defaults -->
  <div class="settings-section section-defaults">
    <div class="section-bar">
      <span class="section-bar-title">Account Defaults</span>
    </div>
    <div class="section-body">
      <div class="setting-row">
        <span class="setting-label">
          Uncategorized
          <button
            type="button"
            class="help-btn"
            use:tooltip={'Imported transactions with no matched category will use this account.'}
            aria-label="Uncategorized account help">?</button
          >
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
          <button
            type="button"
            class="help-btn"
            use:tooltip={'Equity account used to balance cross-currency transfers. Required for multi-currency imports.'}
            aria-label="Conversion balance help">?</button
          >
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
          <button
            type="button"
            class="help-btn"
            use:tooltip={'Equity account used as the offset when posting a reconciliation adjustment.'}
            aria-label="Adjustments help">?</button
          >
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
          <button
            type="button"
            class="help-btn"
            use:tooltip={'Your home currency. Used for FX conversion displays.'}
            aria-label="Preferred currency help">?</button
          >
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
          <button
            type="button"
            class="help-btn"
            use:tooltip={"Root prefix for asset accounts (e.g. 'assets' → 'assets:bank:chequing')."}
            aria-label="Assets root path help">?</button
          >
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
          <button
            type="button"
            class="help-btn"
            use:tooltip={"Root prefix for liability accounts (e.g. 'liabilities' → 'liabilities:creditcard')."}
            aria-label="Liabilities root path help">?</button
          >
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
          <button
            type="button"
            class="help-btn"
            use:tooltip={'Root prefix for expense accounts. Used to filter spending reports.'}
            aria-label="Expenses root path help">?</button
          >
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
          <button
            type="button"
            class="help-btn"
            use:tooltip={"Root prefix for equity accounts. (e.g. 'equity' → 'equity:investments')."}
            aria-label="Equity root path help">?</button
          >
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

  <!-- Accounts (right column) -->
  <div class="settings-section section-accounts">
    <div class="section-bar">
      <span class="section-bar-title">Accounts · {accounts.length}</span>
    </div>
    <form
      class="add-row"
      onsubmit={(e) => {
        e.preventDefault()
        handleCreateAccount()
      }}
    >
      <TextInput
        bind:value={newAccountPath}
        placeholder="assets:cash"
        spellcheck={false}
        style="flex: 1; min-width: 0; width: auto"
      />
      <GradientButton type="submit" active disabled={!newAccountPath.trim()}
        >Add</GradientButton
      >
    </form>
    <div class="accounts-list" use:scrollShadow>
      {#each sortedAccounts as account (account.id)}
        <div class="list-row">
          <span class="account-path">{account.path}</span>
          <GradientButton
            square
            variant="warning"
            onclick={() => handleDeleteAccount(account.id)}
            tooltip="Delete account"
          >
            <Icon name="trash" size={12} />
          </GradientButton>
        </div>
      {/each}
      {#if accounts.length === 0}
        <p class="accounts-empty">No accounts yet.</p>
      {/if}
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
  /* --- Two-column grid layout --- */
  .page {
    display: grid;
    grid-template-columns: 1fr 320px;
    grid-template-rows: auto auto auto 1fr;
    grid-template-areas:
      'user     accts'
      'defaults accts'
      'roots    accts'
      'danger   accts';
    background: var(--color-window);
    margin: calc(-1 * var(--sp-lg));
    height: calc(100% + 2 * var(--sp-lg));
    overflow: hidden;
  }

  .section-user {
    grid-area: user;
    border-bottom: 1px solid var(--color-rule);
  }
  .section-defaults {
    grid-area: defaults;
    border-bottom: 1px solid var(--color-rule);
  }
  .section-roots {
    grid-area: roots;
    border-bottom: 1px solid var(--color-rule);
  }
  .section-danger {
    grid-area: danger;
  }
  .section-accounts {
    grid-area: accts;
    border-left: 1px solid var(--color-rule);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  @media (max-width: 640px) {
    .page {
      grid-template-columns: 1fr;
      grid-template-rows: auto;
      grid-template-areas:
        'user'
        'defaults'
        'roots'
        'accts'
        'danger';
      margin: calc(-1 * var(--sp-md));
      height: auto;
      overflow: visible;
    }

    .section-accounts {
      border-left: none;
      border-bottom: 1px solid var(--color-rule);
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
    font-weight: 700;
    letter-spacing: 0.6px;
    flex: 1;
  }

  .user-email {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-section-bar-fg);
    opacity: 0.75;
    flex: 1;
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

  /* --- Setting rows --- */
  .setting-row {
    display: grid;
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
    font-weight: 700;
    letter-spacing: 0.4px;
    color: var(--color-text-muted);
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  .help-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--color-text-muted);
    color: var(--color-window);
    font-size: 9px;
    font-weight: bold;
    border: none;
    cursor: help;
    flex-shrink: 0;
    line-height: 1;
    padding: 0;
  }

  /* --- Accounts column --- */
  .add-row {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: 7px 14px;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window-raised);
    flex-shrink: 0;
  }

  .accounts-list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .list-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 4px 14px;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window-inset);
    transition: background var(--duration-fast) var(--ease);
  }

  .list-row:last-child {
    border-bottom: none;
  }

  .list-row:hover {
    background: var(--color-accent-light);
  }

  .account-path {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .accounts-empty {
    padding: var(--sp-md) 14px;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-muted);
    margin: 0;
  }

  /* --- Danger row --- */
  .danger-row {
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
    font-weight: 700;
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
