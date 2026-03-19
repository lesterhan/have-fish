<script lang="ts">
  import { onMount } from "svelte";
  import { fetchAccounts, createAccount, deleteAccount } from "$lib/api";

  let accounts = $state<Awaited<ReturnType<typeof fetchAccounts>>>([]);
  let newAccountPath = $state("");

  onMount(async () => {
    accounts = await fetchAccounts();
  });

  async function handleCreateAccount() {
    const created = await createAccount({ path: newAccountPath });
    accounts = [...accounts, created];
    newAccountPath = "";
  }

  async function handleDeleteAccount(id: string) {
    await deleteAccount(id);
    accounts = accounts.filter((acc: { id: string }) => acc.id !== id);
  }
</script>

<h1>Settings</h1>

<section>
  <h2>Accounts</h2>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleCreateAccount();
    }}
  >
    <input bind:value={newAccountPath} placeholder="assets:cash" />
    <button type="submit">Add Account</button>
  </form>

  {#each accounts as account}
    <div>
      {account.path}
      <button onclick={() => handleDeleteAccount(account.id)}>delete</button>
    </div>
  {/each}
</section>
