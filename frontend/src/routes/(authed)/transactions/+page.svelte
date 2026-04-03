<script lang="ts">
  import {
    fetchTransactions,
    fetchAccounts,
    fetchUserSettings,
    type Account,
  } from "$lib/api";
  import AddTransactionModal from "$lib/components/AddTransactionModal.svelte";
  import Button from "$lib/components/Button.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { toISODate } from "$lib/date";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import FilterPanel from "$lib/components/FilterPanel.svelte";
  import TransactionRow from "$lib/components/TransactionRow.svelte";
  import TransactionRowSkeleton from "$lib/components/TransactionRowSkeleton.svelte";

  // Default range: today minus 30 days → today
  // Computed once at module load; stable for the lifetime of the page.
  function defaultRange() {
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - 30);
    return {
      from: toISODate(from),
      to: toISODate(today),
    };
  }
  const defaults = defaultRange();

  // Read from URL search params, fall back to defaults if absent.
  let from = $derived(page.url.searchParams.get("from") ?? defaults.from);
  let to = $derived(page.url.searchParams.get("to") ?? defaults.to);
  let sortDir = $derived(
    (page.url.searchParams.get("dir") ?? "desc") as "asc" | "desc",
  );
  let accountPath = $derived(page.url.searchParams.get("accountPath") ?? "");

  let transactions = $state<Awaited<ReturnType<typeof fetchTransactions>>>([]);
  let accounts = $state<Account[]>([]);
  let defaultOffsetAccountId = $state<string | null>(null);
  let defaultConversionAccountId = $state<string | null>(null);
  let loading = $state(true);
  let addModalOpen = $state(false);

  // Re-fetch transactions whenever from/to/accountPath change.
  $effect(() => {
    loading = true;
    fetchTransactions({ from, to, accountPath: accountPath || undefined }).then(
      (txs) => {
        transactions = txs;
        loading = false;
      },
    );
  });

  let sortedTransactions = $derived(
    [...transactions].sort((a, b) => {
      const cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      return sortDir === "desc" ? -cmp : cmp;
    }),
  );

  function navigate(params: Record<string, string>) {
    const base: Record<string, string> = { from, to, dir: sortDir };
    if (accountPath) base.accountPath = accountPath;
    goto(`?${new URLSearchParams({ ...base, ...params })}`);
  }

  function handleApply(newFrom: string, newTo: string) {
    navigate({ from: newFrom, to: newTo });
  }

  function handleSortChange(dir: "asc" | "desc") {
    navigate({ dir });
  }

  function handleAccountPathChange(path: string) {
    const base: Record<string, string> = { from, to, dir: sortDir };
    if (path) base.accountPath = path;
    goto(`?${new URLSearchParams(base)}`);
  }

  // Accounts and settings don't depend on the date range — fetch once.
  onMount(async () => {
    [accounts, { defaultOffsetAccountId, defaultConversionAccountId }] =
      await Promise.all([fetchAccounts(), fetchUserSettings()]);
  });
</script>

<AddTransactionModal
  {accounts}
  {defaultOffsetAccountId}
  open={addModalOpen}
  onclose={() => (addModalOpen = false)}
  oncreated={(tx) => {
    // TODO: prepend tx to transactions list (or re-fetch if the new date is outside the current range)
  }}
  onaccountcreated={(a) => (accounts = [...accounts, a])}
/>

<div class="panels">
  <FilterPanel
    {from}
    {to}
    {sortDir}
    {accountPath}
    onApply={handleApply}
    onSortChange={handleSortChange}
    onAccountPathChange={handleAccountPathChange}
  />
  <Panel title="Operations">
    <div class="ops-body">
      <Button onclick={() => (addModalOpen = true)}>New ➕</Button>
      <Button disabled title="Coming soon">Export 📤</Button>
    </div>
  </Panel>
</div>

{#if loading}
  <div class="tx-table">
    {#each { length: 7 } as _}
      <TransactionRowSkeleton />
    {/each}
  </div>
{:else if sortedTransactions.length === 0}
  <p class="empty">No transactions 🕵️</p>
{:else}
  <div class="tx-table">
    {#each sortedTransactions as tx (tx.id)}
      <TransactionRow
        {tx}
        {accounts}
        {defaultOffsetAccountId}
        {defaultConversionAccountId}
        onaccountcreated={(a) => (accounts = [...accounts, a])}
        ondeleted={() =>
          (transactions = transactions.filter(
            (t: { id: string }) => t.id !== tx.id,
          ))}
      />
    {/each}
  </div>
{/if}

<style>
  /* FilterPanel + Operations side by side */
  .panels {
    display: flex;
    gap: var(--sp-sm);
    align-items: flex-start;
    margin-bottom: var(--sp-xl);
  }

  /* FilterPanel takes all remaining space */
  .panels :global(.panel:first-child) {
    flex: 1;
    margin-bottom: 0;
  }

  /* Operations panel — fixed width, no bottom margin */
  .panels :global(.panel:last-child) {
    margin-bottom: 0;
  }

  .ops-body {
    display: flex;
    flex-direction: row;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
  }

  .tx-table {
    box-shadow: var(--shadow-sunken);
    background: var(--color-window-raised);
  }

  .empty {
    box-shadow: var(--shadow-sunken);
    background: var(--color-window-raised);
    padding: var(--sp-md);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin: 0;
  }
</style>
