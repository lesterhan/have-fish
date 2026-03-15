<script lang="ts">
  import { onMount } from "svelte";
  import {
    fetchAccounts,
    createAccount,
    deleteAccount,
    fetchCategories,
    createCategory,
    deleteCategory,
  } from "$lib/api";

  let accounts = $state<Awaited<ReturnType<typeof fetchAccounts>>>([]);
  let categories = $state<Awaited<ReturnType<typeof fetchCategories>>>([]);

  let newAccountName = $state("");
  let newAccountType = $state("");
  let newAccountCurrency = $state("CAD");

  let newCategoryName = $state("");

  onMount(async () => {
    accounts = await fetchAccounts();
    categories = await fetchCategories();
  });

  async function handleCreateAccount() {
    const created = await createAccount({
      name: newAccountName,
      type: newAccountType,
      currency: newAccountCurrency,
    });
    accounts = [...accounts, created];
    newAccountName = "";
    newAccountType = "";
    newAccountCurrency = "CAD";
  }

  async function handleDeleteAccount(id: string) {
    await deleteAccount(id);
    accounts = accounts.filter((acc) => acc.id !== id);
  }

  async function handleCreateCategory() {
    const created = await createCategory({
      name: newCategoryName,
    });
    categories = [...categories, created];
    newCategoryName = "";
  }

  async function handleDeleteCategory(id: string) {
    await deleteCategory(id);
    categories = categories.filter((cat) => cat.id !== id);
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
    <input
      bind:value={newAccountName}
      placeholder="Lannisters Credit Union Savings"
    />
    <input bind:value={newAccountType} placeholder="Savings" />
    <input bind:value={newAccountCurrency} placeholder="CAD" />
    <button type="submit">Add Account</button>
  </form>

  {#each accounts as account}
    <div>
      {account.name} — {account.type} ({account.currency})
      <button onclick={() => handleDeleteAccount(account.id)}>delete</button>
    </div>
  {/each}
</section>

<section>
  <h2>Categories</h2>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleCreateCategory();
    }}
  >
    <input bind:value={newCategoryName} placeholder="Foods" />
    <button type="submit">Add Category</button>
  </form>
  {#each categories as category}
    <div>
      {category.name}
      <button onclick={() => handleDeleteCategory(category.id)}>delete</button>
    </div>
  {/each}
</section>
