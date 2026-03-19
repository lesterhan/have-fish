<script lang="ts">
  import { fetchTransactions, fetchAccounts } from '$lib/api'
  import { onMount } from 'svelte'

  let transactions = $state<Awaited<ReturnType<typeof fetchTransactions>>>([])
  let accountPaths = $state<Record<string, string>>({})

  onMount(async () => {
    const [txs, accounts] = await Promise.all([fetchTransactions(), fetchAccounts()])
    transactions = txs
    accountPaths = Object.fromEntries(accounts.map((a: { id: string; path: string }) => [a.id, a.path]))
  })
</script>

<h1>Transactions</h1>

{#if transactions.length === 0}
  <p>No transactions yet.</p>
{:else}
  <div class="journal">
    {#each transactions as tx}
      <div class="transaction">
        <div class="header">
          <span class="date">{new Date(tx.date).toISOString().slice(0, 10)}</span>
          <span class="description">{tx.description ?? ''}</span>
        </div>
        {#each tx.postings as posting}
          <div class="posting">
            <span class="account">{accountPaths[posting.accountId] ?? posting.accountId}</span>
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
