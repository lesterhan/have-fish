<script lang="ts">
  import {
    fetchTransactions,
    fetchAccounts,
    fetchUserSettings,
    type Account,
  } from "$lib/api";
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

  let transactions = $state<Awaited<ReturnType<typeof fetchTransactions>>>([]);
  let accounts = $state<Account[]>([]);
  let defaultOffsetAccountId = $state<string | null>(null);
  let defaultConversionAccountId = $state<string | null>(null);
  let loading = $state(true);

  // Re-fetch transactions whenever from/to change.
  $effect(() => {
    loading = true;
    fetchTransactions({ from, to }).then((txs) => {
      transactions = txs;
      loading = false;
    });
  });

  let sortedTransactions = $derived(
    [...transactions].sort((a, b) => {
      const cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      return sortDir === "desc" ? -cmp : cmp;
    }),
  );

  function navigate(params: Record<string, string>) {
    goto(`?${new URLSearchParams({ from, to, dir: sortDir, ...params })}`);
  }

  function handleApply(newFrom: string, newTo: string) {
    navigate({ from: newFrom, to: newTo });
  }

  function handleSortChange(dir: "asc" | "desc") {
    navigate({ dir });
  }

  // Accounts and settings don't depend on the date range — fetch once.
  onMount(async () => {
    [accounts, { defaultOffsetAccountId, defaultConversionAccountId }] =
      await Promise.all([fetchAccounts(), fetchUserSettings()]);
  });
</script>

<FilterPanel
  {from}
  {to}
  {sortDir}
  onApply={handleApply}
  onSortChange={handleSortChange}
/>

{#if loading}
  <div class="tx-table">
    {#each { length: 7 } as _}
      <TransactionRowSkeleton />
    {/each}
  </div>
{:else if sortedTransactions.length === 0}
  <p class="empty">No transactions yet.</p>
{:else}
  <div class="tx-table">
    {#each sortedTransactions as tx (tx.id)}
      <TransactionRow
        {tx}
        {accounts}
        {defaultOffsetAccountId}
        {defaultConversionAccountId}
        onaccountcreated={(a) => (accounts = [...accounts, a])}
      />
    {/each}
  </div>
{/if}

<style>
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
    font-style: italic;
    margin: 0;
  }
</style>
