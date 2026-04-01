<script lang="ts">
  import { onMount } from "svelte";
  import {
    fetchAccounts,
    createAccount,
    deleteAccount,
    fetchUserSettings,
    updateUserSettings,
  } from "$lib/api";
  import type { Account, UserSettings } from "$lib/api";
  import Button from "$lib/components/Button.svelte";
  import HeadingBanner from "$lib/components/HeadingBanner.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { signOut, useSession, authClient } from "$lib/auth";
  import { goto } from "$app/navigation";

  const session = useSession();

  async function handleSignOut() {
    await signOut();
    goto("/login");
  }

  // --- Defaults ---
  let userSettings = $state<UserSettings | null>(null);

  // --- Accounts ---
  let accounts = $state<Account[]>([]);
  let newAccountPath = $state("");

  onMount(async () => {
    const [accts, settings] = await Promise.all([
      fetchAccounts(),
      fetchUserSettings(),
    ]);
    accounts = accts;
    userSettings = settings;
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

  async function handleDefaultChange(
    field: "defaultOffsetAccountId" | "defaultConversionAccountId",
    accountId: string,
  ) {
    userSettings = await updateUserSettings({ [field]: accountId || null });
  }

  async function handleAssetsRootPathChange(value: string) {
    if (!value.trim()) return;
    userSettings = await updateUserSettings({
      defaultAssetsRootPath: value.trim(),
    });
  }

  // --- Danger zone ---
  let showDeleteConfirm = $state(false);

  async function handleDeleteUser() {
    await authClient.deleteUser();
    goto("/login");
  }
</script>

{#if $session.data}
  <HeadingBanner>
    <h1>🧧 {$session.data.user.email}</h1>
    <Button variant="danger" onclick={handleSignOut}>Sign out</Button>
  </HeadingBanner>
{/if}

<section>
  <h2>Defaults</h2>
  <div class="defaults-grid">
    <label for="default-offset">Offset account</label>
    <select
      id="default-offset"
      value={userSettings?.defaultOffsetAccountId ?? ""}
      onchange={(e) =>
        handleDefaultChange(
          "defaultOffsetAccountId",
          (e.currentTarget as HTMLSelectElement).value,
        )}
    >
      <option value="">— none —</option>
      {#each accounts as account}
        <option value={account.id}>{account.path}</option>
      {/each}
    </select>

    <label for="default-conversion">Conversion account</label>
    <select
      id="default-conversion"
      value={userSettings?.defaultConversionAccountId ?? ""}
      onchange={(e) =>
        handleDefaultChange(
          "defaultConversionAccountId",
          (e.currentTarget as HTMLSelectElement).value,
        )}
    >
      <option value="">— none —</option>
      {#each accounts as account}
        <option value={account.id}>{account.path}</option>
      {/each}
    </select>

    <label for="assets-root-path">Assets root path</label>
    <input
      id="assets-root-path"
      type="text"
      value={userSettings?.defaultAssetsRootPath ?? "assets"}
      onblur={(e) =>
        handleAssetsRootPathChange((e.currentTarget as HTMLInputElement).value)}
      placeholder="assets"
    />
  </div>
</section>

<section>
  <h2>Accounts</h2>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleCreateAccount();
    }}
  >
    <input bind:value={newAccountPath} placeholder="assets:cash" />
    <Button type="submit" variant="primary">Add Account</Button>
  </form>

  {#each accounts as account}
    <div class="list-row">
      {account.path}
      <Button variant="danger" onclick={() => handleDeleteAccount(account.id)}
        >delete</Button
      >
    </div>
  {/each}
</section>


<Panel title="DANGER">
  <div class="danger-body">
    <div class="danger-row">
      <div class="danger-description">
        <strong>Delete my account</strong>
        <p>Permanently removes your account and all associated data. This cannot be undone.</p>
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
  .defaults-grid {
    display: grid;
    grid-template-columns: 12rem 1fr;
    gap: var(--sp-xs) var(--sp-sm);
    align-items: center;
  }

  .defaults-grid label {
    font-size: var(--text-sm);
    text-align: right;
  }

  section {
    margin-bottom: var(--sp-xl);
  }

  h2 {
    font-size: var(--text-sm);
    font-weight: bold;
    margin-bottom: var(--sp-sm);
    padding-bottom: var(--sp-xs);
    border-bottom: 1px solid var(--color-border);
  }

  h3 {
    font-size: var(--text-sm);
    font-weight: bold;
    margin-bottom: var(--sp-xs);
  }

  .list-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) 0;
    border-bottom: 1px solid var(--color-border);
    font-size: var(--text-sm);
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

  select,
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

  select:focus,
  input:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }
</style>
