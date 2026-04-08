<script lang="ts">
  import { onMount } from "svelte";
  import {
    fetchAccounts,
    createAccount,
    deleteAccount,
  } from "$lib/api";
  import type { Account } from "$lib/api";
  import { settingsStore } from "$lib/settings.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import HeadingBanner from "$lib/components/ui/HeadingBanner.svelte";
  import AccountPathInput from "$lib/components/accounts/AccountPathInput.svelte";
  import Panel from "$lib/components/ui/Panel.svelte";
  import Modal from "$lib/components/ui/Modal.svelte";
  import { signOut, useSession, authClient } from "$lib/auth";
  import { goto } from "$app/navigation";
  import { toast } from "$lib/toast.svelte";
  import { tooltip } from "$lib/tooltip";

  const session = useSession();

  async function handleSignOut() {
    await signOut();
    goto("/login");
  }

  // --- Defaults ---
  let offsetAccountId = $state("");
  let conversionAccountId = $state("");
  let adjustmentsAccountId = $state("");

  // --- Accounts ---
  let accounts = $state<Account[]>([]);
  let newAccountPath = $state("");

  onMount(async () => {
    const [accts, settings] = await Promise.all([
      fetchAccounts(),
      settingsStore.load(),
    ]);
    accounts = accts;
    offsetAccountId = settings.defaultOffsetAccountId ?? "";
    conversionAccountId = settings.defaultConversionAccountId ?? "";
    adjustmentsAccountId = settings.defaultAdjustmentsAccountId ?? "";
  });

  async function handleCreateAccount() {
    const created = await createAccount({ path: newAccountPath });
    accounts = [...accounts, created];
    newAccountPath = "";
  }

  async function handleDeleteAccount(id: string) {
    await deleteAccount(id);
    accounts = accounts.filter((a: { id: string }) => a.id !== id);
  }

  const defaultLabels: Record<string, string> = {
    defaultOffsetAccountId: "Uncategorized account",
    defaultConversionAccountId: "Conversion account",
    defaultAdjustmentsAccountId: "Adjustments account",
  };

  async function handleDefaultChange(
    field: "defaultOffsetAccountId" | "defaultConversionAccountId" | "defaultAdjustmentsAccountId",
    accountId: string,
  ) {
    await settingsStore.update({ [field]: accountId || null });
    toast.show(`${defaultLabels[field]} saved`);
  }

  const rootPathLabels: Record<string, string> = {
    defaultAssetsRootPath: "Assets root path",
    defaultLiabilitiesRootPath: "Liabilities root path",
    defaultExpensesRootPath: "Expenses root path",
    defaultEquityRootPath: "Equity root path",
  };

  async function handleRootPathChange(
    field: "defaultAssetsRootPath" | "defaultLiabilitiesRootPath" | "defaultExpensesRootPath" | "defaultEquityRootPath",
    value: string,
  ) {
    if (!value.trim()) return;
    await settingsStore.update({ [field]: value.trim() });
    toast.show(`${rootPathLabels[field]} saved`);
  }

  // --- Accounts ---
  let accountsExpanded = $state(false)

  // --- Danger zone ---
  let showDeleteConfirm = $state(false);

  async function handleDeleteUser() {
    await authClient.deleteUser();
    goto("/login");
  }
</script>

{#if $session.data}
  <HeadingBanner>
    <h1><button class="secret-btn" onclick={() => toast.show('年年有鱼 Year Year Have Fish')}>🧧</button> {$session.data.user.email}</h1>
    <Button variant="danger" onclick={handleSignOut}>Sign out</Button>
  </HeadingBanner>
{/if}

<section>
  <h2>Defaults</h2>
  <div class="defaults-columns">
    <div class="defaults-panel">
      <h3>Account defaults</h3>
      <div class="field-grid">
        <label for="default-offset" class="tip-label">
          Uncategorized
          <button
            type="button"
            class="tip"
            use:tooltip={"Imported transactions with no matched category will use this account. Used to note uncategorized transactions."}
            aria-label="Imported transactions with no matched category will use this account. Used to note uncategorized transactions."
            >?</button
          >
        </label>
        <AccountPathInput
          {accounts}
          bind:value={offsetAccountId}
          placeholder="liabilities:offset"
          oncommit={(id) => handleDefaultChange("defaultOffsetAccountId", id)}
          oncreate={(a) => {
            accounts = [...accounts, a];
          }}
        />

        <label for="default-conversion" class="tip-label">
          Conversion balance
          <button
            type="button"
            class="tip"
            use:tooltip={"Equity account used to balance cross-currency transfers. Required for multi-currency imports."}
            aria-label="Equity account used to balance cross-currency transfers. Required for multi-currency imports."
            >?</button
          >
        </label>
        <AccountPathInput
          {accounts}
          bind:value={conversionAccountId}
          placeholder="equity:conversions"
          oncommit={(id) =>
            handleDefaultChange("defaultConversionAccountId", id)}
          oncreate={(a) => {
            accounts = [...accounts, a];
          }}
        />

        <label for="default-adjustments" class="tip-label">
          Adjustments
          <button
            type="button"
            class="tip"
            use:tooltip={"Equity account used as the offset when posting a reconciliation adjustment."}
            aria-label="Equity account used as the offset when posting a reconciliation adjustment."
            >?</button
          >
        </label>
        <AccountPathInput
          {accounts}
          bind:value={adjustmentsAccountId}
          placeholder="equity:adjustments"
          oncommit={(id) =>
            handleDefaultChange("defaultAdjustmentsAccountId", id)}
          oncreate={(a) => {
            accounts = [...accounts, a];
          }}
        />
      </div>
    </div>

    <div class="defaults-panel">
      <h3>Root paths</h3>
      <div class="field-grid">
        <label for="assets-root-path" class="tip-label">
          Assets
          <button
            type="button"
            class="tip"
            use:tooltip={"Root path prefix for asset accounts (e.g. 'assets' → 'assets:bank:chequing')."}
            aria-label="Root path prefix for asset accounts (e.g. 'assets' → 'assets:bank:chequing')."
            >?</button
          >
        </label>
        <input
          id="assets-root-path"
          type="text"
          value={settingsStore.value?.defaultAssetsRootPath ?? "assets"}
          onblur={(e) =>
            handleRootPathChange(
              "defaultAssetsRootPath",
              (e.currentTarget as HTMLInputElement).value,
            )}
          placeholder="assets"
        />

        <label for="liabilities-root-path" class="tip-label">
          Liabilities
          <button
            type="button"
            class="tip"
            use:tooltip={"Root path prefix for liability accounts (e.g. 'liabilities' → 'liabilities:creditcard')."}
            aria-label="Root path prefix for liability accounts (e.g. 'liabilities' → 'liabilities:creditcard')."
            >?</button
          >
        </label>
        <input
          id="liabilities-root-path"
          type="text"
          value={settingsStore.value?.defaultLiabilitiesRootPath ?? "liabilities"}
          onblur={(e) =>
            handleRootPathChange(
              "defaultLiabilitiesRootPath",
              (e.currentTarget as HTMLInputElement).value,
            )}
          placeholder="liabilities"
        />

        <label for="expenses-root-path" class="tip-label">
          Expenses
          <button
            type="button"
            class="tip"
            use:tooltip={"Root path prefix for expense accounts. Used to filter spending reports (e.g. 'expenses' → 'expenses:food')."}
            aria-label="Root path prefix for expense accounts. Used to filter spending reports (e.g. 'expenses' → 'expenses:food')."
            >?</button
          >
        </label>
        <input
          id="expenses-root-path"
          type="text"
          value={settingsStore.value?.defaultExpensesRootPath ?? "expenses"}
          onblur={(e) =>
            handleRootPathChange(
              "defaultExpensesRootPath",
              (e.currentTarget as HTMLInputElement).value,
            )}
          placeholder="expenses"
        />

        <label for="equity-root-path" class="tip-label">
          Equity
          <button
            type="button"
            class="tip"
            use:tooltip={"Root path prefix for equity accounts. Used to group equity in the sidebar (e.g. 'equity' → 'equity:conversions')."}
            aria-label="Root path prefix for equity accounts. Used to group equity in the sidebar (e.g. 'equity' → 'equity:conversions')."
            >?</button
          >
        </label>
        <input
          id="equity-root-path"
          type="text"
          value={settingsStore.value?.defaultEquityRootPath ?? "equity"}
          onblur={(e) =>
            handleRootPathChange(
              "defaultEquityRootPath",
              (e.currentTarget as HTMLInputElement).value,
            )}
          placeholder="equity"
        />

      </div>
    </div>
  </div>
</section>

<section>
  <button class="accounts-toggle" onclick={() => (accountsExpanded = !accountsExpanded)}>
    <span class="accounts-toggle-arrow">{accountsExpanded ? '🔽' : '▶️'}</span>
    <h2>Accounts <span class="accounts-count">({accounts.length})</span></h2>
  </button>

  {#if accountsExpanded}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        handleCreateAccount();
      }}
      class="add-account-form"
    >
      <input bind:value={newAccountPath} placeholder="assets:cash" class="add-input" />
      <Button type="submit" variant="primary">Add</Button>
    </form>

    <div class="accounts-list">
      {#each [...accounts].sort((a, b) => a.path.localeCompare(b.path)) as account}
        <div class="list-row">
          {account.path}
          <Button variant="danger" onclick={() => handleDeleteAccount(account.id)}>delete</Button>
        </div>
      {/each}
    </div>
  {/if}
</section>

<Panel title="DANGER">
  <div class="danger-body">
    <div class="danger-row">
      <div class="danger-description">
        <strong>Delete my account</strong>
        <p>
          Permanently removes your account and all associated data. This cannot
          be undone.
        </p>
      </div>
      <Button variant="danger" onclick={() => (showDeleteConfirm = true)}>
        Delete my account
      </Button>
    </div>
  </div>
</Panel>

<Modal title="Delete account" bind:open={showDeleteConfirm}>
  <div class="delete-modal">
    <p>Are you sure? You cannot restore your user account.</p>
    <div class="delete-actions">
      <Button onclick={() => (showDeleteConfirm = false)}>Cancel</Button>
      <Button variant="danger" onclick={handleDeleteUser}>Delete user</Button>
    </div>
  </div>
</Modal>

<style>
  .defaults-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-md);
    align-items: stretch;
  }

  .defaults-panel {
    box-shadow: var(--shadow-raised);
    padding: var(--sp-sm);
  }

  .defaults-panel h3 {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--sp-sm);
  }

  .field-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--sp-xs) var(--sp-sm);
    align-items: center;
  }

  .field-grid label {
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  .tip-label {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .tip {
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
    cursor: help;
    flex-shrink: 0;
    line-height: 1;
  }

  .defaults-panel input {
    background: var(--color-window-inset);
    height: 22px;
    padding: 2px var(--sp-xs);
  }

  section {
    margin-bottom: var(--sp-xl);
  }

  h2 {
    font-size: var(--text-sm);
    font-weight: bold;
    color: var(--color-text);
    margin-bottom: var(--sp-sm);
    padding-bottom: var(--sp-xs);
    border-bottom: 1px solid var(--color-border);
  }

  .accounts-toggle {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    width: 100%;
    text-align: left;
    margin-bottom: var(--sp-sm);
  }

  .accounts-toggle h2 {
    margin-bottom: 0;
    border-bottom: none;
    padding-bottom: 0;
  }

  .accounts-toggle:hover h2 {
    color: var(--color-accent-mid);
  }

  .accounts-toggle-arrow {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    width: 12px;
    flex-shrink: 0;
  }

  .accounts-count {
    font-weight: normal;
    color: var(--color-text-muted);
  }

  .add-account-form {
    display: flex;
    gap: var(--sp-sm);
    margin-bottom: var(--sp-sm);
  }

  .add-input {
    flex: 1;
    width: 0; /* override global width: 100% so flex controls the width */
    background: var(--color-window-inset) !important;
  }

  .accounts-list {
    max-height: 220px;
    overflow-y: auto;
    box-shadow: var(--shadow-sunken);
    background: var(--color-window-inset);
  }

  .list-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-border);
    font-size: var(--text-sm);
  }

  .list-row:last-child {
    border-bottom: none;
  }

  /* --- Danger zone --- */

  .danger-body {
    background: var(--color-window);
    padding: var(--sp-sm);
  }

  .danger-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-md);
  }

  .danger-description {
    font-size: var(--text-sm);
  }

  .danger-description strong {
    color: var(--color-danger);
  }

  .danger-description p {
    color: var(--color-text);
    margin-top: 2px;
  }

  /* --- Delete confirmation modal --- */

  .delete-modal {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    padding: var(--sp-sm);
    font-size: var(--text-sm);
  }

  .delete-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-sm);
  }

  .secret-btn {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    cursor: default;
  }

  input {
    font-size: var(--text-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-raised);
    box-shadow: var(--shadow-sunken);
    border: none;
    color: var(--color-text);
    font-family: inherit;
    width: 100%;
  }

  input:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }
</style>
