<script lang="ts">
  import { onMount } from "svelte";
  import { fetchAccountBalances, type AccountBalance } from "$lib/api";
  import Button from "$lib/components/Button.svelte";
  import HeadingBanner from "$lib/components/HeadingBanner.svelte";
  import AddAccountWizard from "$lib/components/AddAccountWizard.svelte";

  let showAddAccount = $state(false);
  let showAddLiability = $state(false);

  let accounts = $state<AccountBalance[]>([]);

  onMount(async () => {
    const balances = await fetchAccountBalances();
    accounts = balances;
  });

  function isZeroBalance(account: AccountBalance): boolean {
    return (
      account.balances.length === 0 ||
      account.balances.every((b) => parseFloat(b.amount) === 0)
    );
  }

  async function refreshAccounts() {
    accounts = await fetchAccountBalances();
  }
</script>

<HeadingBanner>
  <h1>Assets</h1>
  <Button onclick={() => (showAddAccount = true)}>New asset account</Button>
</HeadingBanner>

<AddAccountWizard type="asset" bind:open={showAddAccount} onSuccess={refreshAccounts} />

{#if accounts.length === 0}
  <p class="empty">Couldn't find any asset accounts 🕵️</p>
{:else}
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Account</th>
          <th class="col-balances">Balances</th>
        </tr>
      </thead>
      <tbody>
        {#each accounts as account}
          <tr class:dimmed={isZeroBalance(account)}>
            <td class="cell-path">{account.path}</td>
            <td class="cell-balances">
              {#each account.balances as balance}
                <span
                  class="balance-chip"
                  class:positive={parseFloat(balance.amount) > 0}
                  class:negative={parseFloat(balance.amount) < 0}
                >
                  {balance.amount}
                  {balance.currency}
                </span>
              {:else}
                <span class="balance-empty">—</span>
              {/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<HeadingBanner>
  <h1>Liabilities</h1>
  <Button onclick={() => (showAddLiability = true)}
    >New liability account</Button
  >
</HeadingBanner>

<AddAccountWizard type="liability" bind:open={showAddLiability} onSuccess={refreshAccounts} />

{#if accounts.length === 0}
  <p class="empty">Couldn't find any liability accounts 🕵️</p>
{:else}
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Account</th>
          <th class="col-balances">Balances</th>
        </tr>
      </thead>
      <tbody>
        {#each accounts as account}
          <tr class:dimmed={isZeroBalance(account)}>
            <td class="cell-path">{account.path}</td>
            <td class="cell-balances">
              {#each account.balances as balance}
                <span
                  class="balance-chip"
                  class:positive={parseFloat(balance.amount) > 0}
                  class:negative={parseFloat(balance.amount) < 0}
                >
                  {balance.amount}
                  {balance.currency}
                </span>
              {:else}
                <span class="balance-empty">—</span>
              {/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .empty {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: 0 var(--sp-xs);
    margin-bottom: var(--sp-xl);
  }

  .table-container {
    box-shadow: var(--shadow-sunken);
    background: var(--color-window-inset);
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  th {
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
    padding: var(--sp-xs) var(--sp-sm);
    text-align: left;
    font-weight: var(--weight-semibold);
    white-space: nowrap;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  td {
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-bevel-mid);
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover td {
    background: var(--color-accent-light);
  }

  .cell-path {
    font-family: var(--font-mono);
    width: 100%;
  }

  .col-balances {
    text-align: right;
  }

  .cell-balances {
    display: flex;
    gap: var(--sp-sm);
    justify-content: flex-end;
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .balance-chip.positive {
    color: var(--color-amount-positive);
  }

  .balance-chip.negative {
    color: var(--color-amount-negative);
  }

  .balance-empty {
    color: var(--color-text-muted);
  }

  .dimmed {
    opacity: 0.4;
  }
</style>
