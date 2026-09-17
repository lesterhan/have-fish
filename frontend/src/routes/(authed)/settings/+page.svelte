<script lang="ts">
  import { onMount } from 'svelte'
  import { copy } from '$lib/copy'
  import { fetchAccounts } from '$lib/api'
  import type { Account } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import CurrencyInput from '$lib/components/ui/CurrencyInput.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import { DEFAULT_ROOTS } from '$lib/components/accounts/accountPaths'
  import Modal from '$lib/components/ui/Modal.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { signOut, useSession, authClient } from '$lib/auth'
  import { goto } from '$app/navigation'
  import { tick } from 'svelte'
  import { confetti } from '$lib/confetti.svelte'
  import { toast } from '$lib/toast.svelte'
  import TooltipIcon from '$lib/components/ui/TooltipIcon.svelte'

  const session = useSession()

  /** The one control on this page focused from script, so it is reachable by id. */
  const NAME_INPUT_ID = 'settings-display-name'

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
    document.getElementById(NAME_INPUT_ID)?.focus()
  }

  async function handleSaveName() {
    const trimmed = nameInput.trim()
    if (!trimmed) return
    const result = await authClient.updateUser({ name: trimmed })
    if (result.error) {
      toast.show(copy.settings.user.nameFailed)
    } else {
      toast.show(copy.settings.user.nameSaved)
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

  // Each field names its own confirmation rather than sharing a `${label} saved`
  // template: the assembled version meant "Uncategorized account saved" appeared nowhere
  // in the source, so it could not be found by anyone wanting to edit it.
  const defaultSaved: Record<string, string> = {
    defaultOffsetAccountId: copy.settings.defaults.offset.saved,
    defaultConversionAccountId: copy.settings.defaults.conversion.saved,
    defaultAdjustmentsAccountId: copy.settings.defaults.adjustments.saved,
  }

  async function handleDefaultChange(
    field:
      | 'defaultOffsetAccountId'
      | 'defaultConversionAccountId'
      | 'defaultAdjustmentsAccountId',
    accountId: string,
  ) {
    await settingsStore.update({ [field]: accountId || null })
    toast.show(defaultSaved[field]!)
  }

  const rootPathSaved: Record<string, string> = {
    defaultAssetsRootPath: copy.settings.roots.assets.saved,
    defaultLiabilitiesRootPath: copy.settings.roots.liabilities.saved,
    defaultExpensesRootPath: copy.settings.roots.expenses.saved,
    defaultEquityRootPath: copy.settings.roots.equity.saved,
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
    toast.show(rootPathSaved[field]!)
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
          toast.show(copy.settings.user.greeting)
          confetti.trigger()
        }}
        aria-label={copy.settings.user.greetingLabel}>🧧</button
      >
      {#if $session.data}
        <span class="user-email">{$session.data.user.email}</span>
        <div class="name-section">
          {#if editingName}
            <TextInput
              id={NAME_INPUT_ID}
              bind:value={nameInput}
              placeholder={copy.settings.user.namePlaceholder}
              spellcheck={false}
              style="flex: 1; min-width: 0; height: 20px; font-size: 11px"
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === 'Enter') handleSaveName()
                if (e.key === 'Escape') cancelEditName()
              }}
            />
            <GradientButton
              square
              onclick={handleSaveName}
              tooltip={copy.settings.user.saveName}
            >
              <Icon name="check" size={10} />
            </GradientButton>
            <GradientButton
              square
              onclick={cancelEditName}
              tooltip={copy.case.dialog.cancel}
            >
              <Icon name="close" size={10} />
            </GradientButton>
          {:else}
            <span class="user-display-name" class:placeholder={!displayName}>
              [ {displayName || copy.settings.user.nameUnset} ]
            </span>
            <GradientButton
              square
              onclick={startEditName}
              tooltip={copy.settings.user.editName}
            >
              <Icon name="edit-txn" size={10} />
            </GradientButton>
          {/if}
        </div>
      {/if}
      <GradientButton onclick={handleSignOut}>
        {copy.settings.user.signOut}
      </GradientButton>
    </div>
  </div>

  <!-- Account defaults -->
  <div class="settings-section section-defaults">
    <div class="section-bar">
      <span class="section-bar-title">{copy.settings.defaults.title}</span>
      <!-- These three are pointers *at* accounts, so they stay here; the accounts themselves
           moved. The link is where the old "Manage" button was, for the muscle memory. -->
      <GradientButton
        onclick={() => goto('/accounts')}
        tooltip={copy.settings.defaults.manageHint}
      >
        {copy.settings.defaults.manage}
      </GradientButton>
    </div>
    <div class="section-body">
      <div class="setting-row">
        <span class="setting-label">
          {copy.settings.defaults.offset.label}
          <TooltipIcon label={copy.settings.defaults.offset.hint} />
        </span>
        <AccountPathInput
          {accounts}
          bind:value={offsetAccountId}
          placeholder={copy.settings.defaults.offset.example}
          oncommit={(id) => handleDefaultChange('defaultOffsetAccountId', id)}
          oncreate={(a) => {
            accounts = [...accounts, a]
          }}
        />
      </div>
      <div class="setting-row">
        <span class="setting-label">
          {copy.settings.defaults.conversion.label}
          <TooltipIcon label={copy.settings.defaults.conversion.hint} />
        </span>
        <AccountPathInput
          {accounts}
          bind:value={conversionAccountId}
          placeholder={copy.settings.defaults.conversion.example}
          oncommit={(id) =>
            handleDefaultChange('defaultConversionAccountId', id)}
          oncreate={(a) => {
            accounts = [...accounts, a]
          }}
        />
      </div>
      <div class="setting-row">
        <span class="setting-label">
          {copy.settings.defaults.adjustments.label}
          <TooltipIcon label={copy.settings.defaults.adjustments.hint} />
        </span>
        <AccountPathInput
          {accounts}
          bind:value={adjustmentsAccountId}
          placeholder={copy.settings.defaults.adjustments.example}
          oncommit={(id) =>
            handleDefaultChange('defaultAdjustmentsAccountId', id)}
          oncreate={(a) => {
            accounts = [...accounts, a]
          }}
        />
      </div>
      <div class="setting-row">
        <label class="setting-label" for="preferred-currency">
          {copy.settings.defaults.currency.label}
          <TooltipIcon label={copy.settings.defaults.currency.hint} />
        </label>
        <CurrencyInput
          id="preferred-currency"
          bind:value={preferredCurrency}
          style="width: 7rem"
          oncommit={async () => {
            await settingsStore.update({ preferredCurrency })
            toast.show(copy.settings.defaults.currency.saved)
          }}
        />
      </div>
    </div>
  </div>

  <!-- Root paths -->
  <div class="settings-section section-roots">
    <div class="section-bar">
      <span class="section-bar-title">{copy.settings.roots.title}</span>
    </div>
    <div class="section-body">
      <div class="setting-row">
        <label class="setting-label" for="assets-root-path">
          {copy.settings.roots.assets.label}
          <TooltipIcon label={copy.settings.roots.assets.hint} />
        </label>
        <TextInput
          id="assets-root-path"
          value={settingsStore.value?.defaultAssetsRootPath ??
            DEFAULT_ROOTS.assets}
          onblur={(e) =>
            handleRootPathChange(
              'defaultAssetsRootPath',
              (e.currentTarget as HTMLInputElement).value,
            )}
          placeholder={DEFAULT_ROOTS.assets}
          spellcheck={false}
          style="width: 100%; box-sizing: border-box"
        />
      </div>
      <div class="setting-row">
        <label class="setting-label" for="liabilities-root-path">
          {copy.settings.roots.liabilities.label}
          <TooltipIcon label={copy.settings.roots.liabilities.hint} />
        </label>
        <TextInput
          id="liabilities-root-path"
          value={settingsStore.value?.defaultLiabilitiesRootPath ??
            DEFAULT_ROOTS.liabilities}
          onblur={(e) =>
            handleRootPathChange(
              'defaultLiabilitiesRootPath',
              (e.currentTarget as HTMLInputElement).value,
            )}
          placeholder={DEFAULT_ROOTS.liabilities}
          spellcheck={false}
          style="width: 100%; box-sizing: border-box"
        />
      </div>
      <div class="setting-row">
        <label class="setting-label" for="expenses-root-path">
          {copy.settings.roots.expenses.label}
          <TooltipIcon label={copy.settings.roots.expenses.hint} />
        </label>
        <TextInput
          id="expenses-root-path"
          value={settingsStore.value?.defaultExpensesRootPath ??
            DEFAULT_ROOTS.expenses}
          onblur={(e) =>
            handleRootPathChange(
              'defaultExpensesRootPath',
              (e.currentTarget as HTMLInputElement).value,
            )}
          placeholder={DEFAULT_ROOTS.expenses}
          spellcheck={false}
          style="width: 100%; box-sizing: border-box"
        />
      </div>
      <div class="setting-row">
        <label class="setting-label" for="equity-root-path">
          {copy.settings.roots.equity.label}
          <TooltipIcon label={copy.settings.roots.equity.hint} />
        </label>
        <TextInput
          id="equity-root-path"
          value={settingsStore.value?.defaultEquityRootPath ??
            DEFAULT_ROOTS.equity}
          onblur={(e) =>
            handleRootPathChange(
              'defaultEquityRootPath',
              (e.currentTarget as HTMLInputElement).value,
            )}
          placeholder={DEFAULT_ROOTS.equity}
          spellcheck={false}
          style="width: 100%; box-sizing: border-box"
        />
      </div>
    </div>
  </div>

  <!-- Danger zone. A quiet footer, matching the group settings page: a page you open to
       change a default posting path should not have its most destructive action as the
       loudest thing on it (V3). The alarm belongs in the confirmation, which is where it is. -->
  <div class="danger-footer">
    <button class="danger-link" onclick={() => (showDeleteConfirm = true)}
      >{copy.settings.danger.open}</button
    >
    <span class="danger-desc">{copy.settings.danger.description}</span>
  </div>
</div>

<Modal title={copy.settings.danger.title} bind:open={showDeleteConfirm}>
  <div class="delete-modal">
    <p>{copy.settings.danger.warning}</p>
    <div class="delete-actions">
      <GradientButton onclick={() => (showDeleteConfirm = false)}>
        {copy.case.dialog.cancel}
      </GradientButton>
      <GradientButton variant="warning" active onclick={handleDeleteUser}>
        {copy.settings.danger.confirm}
      </GradientButton>
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
    padding: var(--sp-2xs) var(--gutter);
    flex-shrink: 0;
  }

  .section-bar-title {
    font-weight: var(--weight-bold);
    flex: 1;
  }

  .user-email {
    font-family: var(--font-mono);
    font-size: var(--text-control);
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
    font-weight: var(--weight-bold);
    font-size: var(--text-control);
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
    padding: var(--sp-xs) var(--gutter);
    border-bottom: 1px solid var(--color-rule);
  }

  .setting-row:last-child {
    border-bottom: none;
  }

  .setting-label {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-label);
    color: var(--color-text-muted);
    display: flex;
    align-items: center;
    gap: var(--sp-3xs);
    white-space: nowrap;
  }

  /* --- Danger footer --- */
  /* Pushed to the very bottom of the page so the delete action sits far from the controls
     you came here to use and can't be clicked by accident. Same shape as the group
     settings page's footer, because it is the same action. */
  .danger-footer {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    margin-top: auto;
    padding: var(--sp-lg) var(--gutter) var(--sp-lg);
    border-top: 1px solid var(--color-rule);
  }

  .danger-link {
    background: none;
    border: none;
    padding: 0;
    font-family: var(--font-sans);
    font-size: var(--text-body);
    font-weight: var(--weight-bold);
    color: var(--color-danger);
    cursor: pointer;
    white-space: nowrap;
  }

  .danger-link:hover {
    text-decoration: underline;
  }

  .danger-desc {
    font-family: var(--font-sans);
    font-size: var(--text-dense);
    color: var(--color-text-muted);
  }

  /* --- Secret button --- */
  .secret-btn {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    cursor: pointer;
    line-height: var(--leading-none);
    font-size: var(--text-body);
    flex-shrink: 0;
  }

  /* --- Delete modal --- */
  .delete-modal {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    font-family: var(--font-sans);
    font-size: var(--text-body);
    color: var(--color-text);
    min-width: 340px;
  }

  .delete-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-xs);
  }
</style>
