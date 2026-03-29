<script lang="ts">
  import { fetchTransactions, fetchAccounts } from "$lib/api";
  import { toISODate } from "$lib/date";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import FilterPanel from "$lib/components/FilterPanel.svelte";

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
  let accountPaths = $state<Record<string, string>>({});

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
    const accounts = await fetchAccounts();
    accountPaths = Object.fromEntries(
      accounts.map((a: { id: string; path: string }) => [a.id, a.path]),
    );
  });
</script>

<FilterPanel {from} {to} onApply={handleApply} />

{#if transactions.length === 0}
  <p>No transactions yet.</p>
{:else}
  <div class="journal">
    {#each transactions as tx}
      <div class="transaction">
        <div class="header">
          <span class="date">{toISODate(new Date(tx.date))}</span>
          <span class="description">{tx.description ?? ""}</span>
        </div>
        {#each [...tx.postings].sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)) as posting}
          <div class="posting">
            <span class="account"
              >{accountPaths[posting.accountId] ?? posting.accountId}</span
            >
            <span class="amount">{posting.amount} {posting.currency}</span>
          </div>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .journal {
    font-family: monospace;
  }

  .transaction {
    margin-bottom: 1rem;
  }

  .header {
    display: flex;
    gap: 1rem;
  }

  .date {
    color: #888;
  }

  .posting {
    display: flex;
    justify-content: space-between;
    max-width: 600px;
    padding-left: 2rem;
  }

  .amount {
    text-align: right;
  }
</style>
