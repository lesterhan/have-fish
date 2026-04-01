<script lang="ts">
  import { onMount } from "svelte";
  import { fetchAccountBalances, type AccountBalance } from "$lib/api";
  import Button from "$lib/components/Button.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import AddAccountWizard from "$lib/components/AddAccountWizard.svelte";
  import TableShell from "$lib/components/TableShell.svelte";

  let showAddAccount = $state(false);
  let showAddLiability = $state(false);

  let accounts = $state<AccountBalance[]>([]);
  let loading = $state(true);

  onMount(async () => {
    accounts = await fetchAccountBalances();
    loading = false;
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

  type HierarchyRow = {
    account: AccountBalance;
    depth: number;       // number of ancestors present in the list
    label: string;       // leaf segment if depth > 0, full path otherwise
  };

  function buildHierarchy(rows: AccountBalance[]): HierarchyRow[] {
    const sorted = [...rows].sort((a, b) => a.path.localeCompare(b.path));
    const paths = new Set(sorted.map((a) => a.path));
    return sorted.map((account) => {
      const segments = account.path.split(":");
      let depth = 0;
      for (let i = segments.length - 1; i > 0; i--) {
        if (paths.has(segments.slice(0, i).join(":"))) {
          depth = segments.length - i;
          break;
        }
      }
      return {
        account,
        depth,
        label: depth > 0 ? segments[segments.length - 1] : account.path,
      };
    });
  }
</script>

{#snippet accountTable(rows: AccountBalance[], emptyText: string)}
  <div class="account-table">
    <TableShell
      columns={[
        { label: "Account" },
        { label: "Balances", class: "col-balances" },
      ]}
      {loading}
      empty={rows.length === 0}
      {emptyText}
    >
      {#each buildHierarchy(rows) as { account, depth, label }}
        <tr class:dimmed={isZeroBalance(account)}>
          <td class="cell-path" style="padding-left: calc(var(--sp-sm) + {depth} * 1.25rem)">
            {label}
          </td>
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
    </TableShell>
  </div>
{/snippet}

<AddAccountWizard
  type="asset"
  bind:open={showAddAccount}
  onSuccess={refreshAccounts}
/>
<AddAccountWizard
  type="liability"
  bind:open={showAddLiability}
  onSuccess={refreshAccounts}
/>

<Panel title="Assets">
  <div class="panel-actions">
    <Button onclick={() => (showAddAccount = true)}>New asset account</Button>
  </div>
  {@render accountTable(assets, "No asset accounts 🕵️")}
</Panel>

<Panel title="Liabilities">
  <div class="panel-actions">
    <Button onclick={() => (showAddLiability = true)}
      >New liability account</Button
    >
  </div>
  {@render accountTable(liabilities, "No liability accounts 🕵️")}
</Panel>

<style>
  .panel-actions {
    display: flex;
    justify-content: flex-end;
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-bevel-mid);
    background: var(--color-window);
  }

  /* td styles — table/thead/th owned by TableShell */
  :global(.account-table td) {
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-bevel-mid);
    background: var(--color-window-inset);
  }

  :global(.account-table tbody tr:last-child td) {
    border-bottom: none;
  }

  :global(.account-table tbody tr:hover td) {
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
