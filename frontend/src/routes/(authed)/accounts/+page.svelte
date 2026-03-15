<script lang="ts">
  import { fetchAccounts } from '$lib/api'
  import { onMount } from 'svelte'

  let accounts = $state<Awaited<ReturnType<typeof fetchAccounts>>>([])

  onMount(async () => {
    accounts = await fetchAccounts()
  })
</script>

<h1>Accounts</h1>

{#if accounts.length === 0}
  <p>No accounts yet.</p>
{:else}
  <ul>
    {#each accounts as account}
      <li>{account.name} — {account.type}</li>
    {/each}
  </ul>
{/if}
