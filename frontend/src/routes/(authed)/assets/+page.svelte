<script lang="ts">
  import { onMount } from "svelte";
  import { fetchAccountBalances, type AccountBalance } from "$lib/api";
  import Button from "$lib/components/Button.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import AddAccountWizard from "$lib/components/AddAccountWizard.svelte";

  let showAddAccount = $state(false);
  let showAddLiability = $state(false);

  let accounts = $state<AccountBalance[]>([]);

  onMount(async () => {
    accounts = await fetchAccountBalances();
  });

  async function refreshAccounts() {
    accounts = await fetchAccountBalances();
  }

  let assets = $derived(accounts.filter((a) => a.type === "asset"));
  let liabilities = $derived(accounts.filter((a) => a.type === "liability"));

  function isZeroBalance(account: AccountBalance): boolean {
    return (
      account.balances.length === 0 ||
      account.balances.every((b) => parseFloat(b.amount) === 0)
    );
  }
</script>

{#snippet accountTable(rows: AccountBalance[], emptyText: string)}
  {#if rows.length === 0}
    <p class="empty">{emptyText}</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Account</th>
          <th class="col-balances">Balances</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as account}
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
  {/if}
{/snippet}

<AddAccountWizard type="asset" bind:open={showAddAccount} onSuccess={refreshAccounts} />
<AddAccountWizard type="liability" bind:open={showAddLiability} onSuccess={refreshAccounts} />

<Panel title="Assets">
  <div class="panel-actions">
    <Button onclick={() => (showAddAccount = true)}>New asset account</Button>
  </div>
  {@render accountTable(assets, "Couldn't find any asset accounts 🕵️")}
</Panel>

<Panel title="Liabilities">
  <div class="panel-actions">
    <Button onclick={() => (showAddLiability = true)}>New liability account</Button>
  </div>
  {@render accountTable(liabilities, "Couldn't find any liability accounts 🕵️")}
</Panel>

<style>
  .panel-actions {
    display: flex;
    justify-content: flex-end;
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-bevel-mid);
    background: var(--color-window);
  }

  .empty {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--sp-sm);
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
    background: var(--color-window-inset);
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
