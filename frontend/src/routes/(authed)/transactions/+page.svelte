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

  // Read from URL search params, fall back to default range if absent.
  // Reactive: updating the URL (via goto in FilterPanel) will re-derive these
  // and trigger the $effect below to re-fetch.
  let from = $derived(page.url.searchParams.get("from") ?? defaults.from);
  let to = $derived(page.url.searchParams.get("to") ?? defaults.to);

  let transactions = $state<Awaited<ReturnType<typeof fetchTransactions>>>([]);
  let accounts = $state<Account[]>([]);

  // Re-fetch transactions whenever from/to change.
  $effect(() => {
    fetchTransactions({ from, to }).then((txs) => {
      transactions = txs;
    });
  });

  // Called by FilterPanel when the user clicks Apply or Reset.
  // Pushes the new range into the URL; the $derived from/to above will re-derive
  // and the $effect will re-fetch automatically.
  function handleApply(newFrom: string, newTo: string) {
    goto(`?${new URLSearchParams({ from: newFrom, to: newTo })}`);
  }

  // Accounts don't depend on the date range — fetch once.
  onMount(async () => {
    accounts = await fetchAccounts();
  });
</script>

<FilterPanel {from} {to} onApply={handleApply} />

{#if transactions.length === 0}
  <p>No transactions yet.</p>
{:else}
  <div class="tx-table">
    {#each transactions as tx}
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
