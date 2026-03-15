<script lang="ts">
  import { fetchTransactions } from '$lib/api'
  import { onMount } from 'svelte'

  let transactions = $state<Awaited<ReturnType<typeof fetchTransactions>>>([])

  onMount(async () => {
    transactions = await fetchTransactions()
  })
</script>

<h1>Transactions</h1>

{#if transactions.length === 0}
  <p>No transactions yet.</p>
{:else}
  <ul>
    {#each transactions as tx}
      <li>{tx.date} — {tx.description} — {tx.amount}</li>
    {/each}
  </ul>
{/if}
