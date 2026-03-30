<script lang="ts">
  import { fetchTransactions, fetchAccounts, type Account } from "$lib/api";
  import { toISODate } from "$lib/date";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import FilterPanel from "$lib/components/FilterPanel.svelte";
  import TransactionRow from "$lib/components/TransactionRow.svelte";

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
  let sortDir = $derived((page.url.searchParams.get("dir") ?? "desc") as "asc" | "desc");

  let transactions = $state<Awaited<ReturnType<typeof fetchTransactions>>>([]);
  let accounts = $state<Account[]>([]);

  // Re-fetch transactions whenever from/to change.
  $effect(() => {
    fetchTransactions({ from, to }).then((txs) => {
      transactions = txs;
    });
  });

  let sortedTransactions = $derived(
    [...transactions].sort((a, b) => {
      const cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      return sortDir === "desc" ? -cmp : cmp;
    })
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

  // Accounts don't depend on the date range — fetch once.
  onMount(async () => {
    accounts = await fetchAccounts();
  });
</script>

<FilterPanel {from} {to} {sortDir} onApply={handleApply} onSortChange={handleSortChange} />

{#if sortedTransactions.length === 0}
  <p>No transactions yet.</p>
{:else}
  <div class="tx-table">
    {#each sortedTransactions as tx (tx.id)}
      <TransactionRow {tx} {accounts} onaccountcreated={(a) => accounts = [...accounts, a]} />
    {/each}
  </div>
{/if}

<style>
  .tx-table {
    box-shadow: var(--shadow-sunken);
    background: var(--color-window-raised);
  }
</style>
