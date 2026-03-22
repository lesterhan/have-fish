<script lang="ts">
  import { onMount } from "svelte";
  import {
    fetchAccounts,
    fetchUserSettings,
    importPreview,
    importCommit,
    type ImportPreviewResult,
  } from "$lib/api";
  import Button from "$lib/components/Button.svelte";
  import AccountPathInput from "$lib/components/AccountPathInput.svelte";

  let accounts = $state<Awaited<ReturnType<typeof fetchAccounts>>>([]);
  let fromAccountId = $state("");
  let toAccountId = $state("");
  let defaultCurrency = $state("CAD");
  let file = $state<File | null>(null);
  let loading = $state(false);
  let error = $state("");
  let noParserFound = $state(false);
  let imported = $state<number | null>(null);

  let preview = $state<ImportPreviewResult | null>(null);
  // Per-row "to account" IDs, seeded from toAccountId when preview loads.
  let txToAccounts = $state<string[]>([]);

  onMount(async () => {
    const [accts, settings] = await Promise.all([
      fetchAccounts(),
      fetchUserSettings(),
    ]);
    accounts = accts;
    toAccountId = settings.defaultOffsetAccountId ?? "";
  });

  async function handleConfirm() {
    if (!preview) return;
    if (!fromAccountId) {
      error = "From account is required.";
      return;
    }
    if (txToAccounts.some((id) => !id)) {
      error = "All transactions must have a To account assigned.";
      return;
    }
    loading = true;
    error = "";
    try {
      const result = await importCommit({
        accountId: fromAccountId,
        defaultCurrency,
        transactions: preview.transactions.map((tx, i) => ({
          ...tx,
          offsetAccountId: txToAccounts[i],
        })),
      });
      imported = result.created;
      preview = null;
      txToAccounts = [];
    } catch (e) {
      error = "Import failed. Please try again.";
    } finally {
      loading = false;
    }
  }

  async function handleSubmit() {
    if (!file || !toAccountId || !defaultCurrency) {
      error = "All fields are required.";
      return;
    }
    error = "";
    noParserFound = false;
    loading = true;
    try {
      preview = await importPreview(file, defaultCurrency);
      fromAccountId = preview.defaultAccountId ?? "";
      // Seed every row with the global to account — user can override per row in the table
      txToAccounts = preview.transactions.map(() => toAccountId);
    } catch (e) {
      error =
        e instanceof Error
          ? e.message
          : "Failed to parse the CSV. Please check the file and try again.";
      noParserFound = error.toLowerCase().includes("no saved parser");
    } finally {
      loading = false;
    }
  }

  function handleAccountCreated(account: { id: string; path: string }) {
    accounts = [...accounts, account];
  }

  function handleCancel() {
    preview = null;
    fromAccountId = "";
    txToAccounts = [];
  }
</script>

<h1>Import</h1>

{#if !preview}
  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleSubmit();
    }}
  >
    <label>
      To account
      <AccountPathInput
        {accounts}
        bind:value={toAccountId}
        placeholder="Select or create an account…"
        oncreate={handleAccountCreated}
      />
    </label>

    <label>
      Default currency
      <input
        type="text"
        bind:value={defaultCurrency}
        placeholder="CAD"
        required
      />
    </label>

    <label>
      CSV file
      <input
        type="file"
        accept=".csv"
        onchange={(e) => {
          file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
        }}
        required
      />
    </label>

    {#if error}
      <p class="error">{error}</p>
      {#if noParserFound}
        <p class="hint">
          Go to <a href="/settings">Settings</a> to create a parser for this file.
        </p>
      {/if}
    {/if}

    <Button type="submit" variant="primary" disabled={loading}>
      {loading ? "Parsing…" : "Preview import"}
    </Button>
  </form>
{:else}
  <h2>Preview</h2>
  <p class="parser-tag">Parser: <strong>{preview.parser}</strong></p>

  <div class="account-row">
    <label for="from-account">
      From account
      {#if !fromAccountId}<span class="required">*</span>{/if}
    </label>
    <AccountPathInput
      {accounts}
      bind:value={fromAccountId}
      placeholder="Select or create an account…"
      oncreate={handleAccountCreated}
    />
  </div>

  {#if preview.errors.length > 0}
    <div class="parse-errors">
      <p>
        {preview.errors.length} row(s) could not be parsed and will be skipped.
      </p>
      <ul>
        {#each preview.errors as e}
          <li>Row {e.row}: {e.reason}</li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th class="col-description">Description</th>
          <th class="col-amount">Amount</th>
          <th>Currency</th>
          <th class="col-offset">To account</th>
        </tr>
      </thead>
      <tbody>
        {#each preview.transactions as tx, i}
          <tr>
            <td class="cell-mono">{new Date(tx.date).toLocaleDateString()}</td>
            <td>{tx.description ?? "—"}</td>
            <td
              class="cell-amount"
              class:positive={parseFloat(tx.amount) > 0}
              class:negative={parseFloat(tx.amount) < 0}
            >
              {tx.amount}
            </td>
            <td>{tx.currency ?? defaultCurrency}</td>
            <td class="cell-offset">
              <AccountPathInput
                {accounts}
                bind:value={txToAccounts[i]}
                placeholder="Select or create…"
                oncreate={handleAccountCreated}
              />
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <p class="summary">
    {preview.transactions.length} transaction(s) ready to import.
  </p>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <div class="actions">
    <Button onclick={handleCancel}>Cancel</Button>
    <Button
      variant="primary"
      onclick={handleConfirm}
      disabled={loading ||
        preview.transactions.length === 0 ||
        !fromAccountId ||
        txToAccounts.some((id) => !id)}
    >
      {loading ? "Importing…" : "Confirm import"}
    </Button>
  </div>
{/if}

{#if imported !== null}
  <p>
    {imported} transaction(s) imported successfully.
    <a href="/transactions">View transactions</a>
  </p>
{/if}

<style>
  .parser-tag {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin-bottom: var(--sp-sm);
  }

  .hint {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin-top: var(--sp-xs);
  }

  /* --- From account selector row --- */

  .account-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    margin-bottom: var(--sp-md);
    font-size: var(--text-sm);
  }

  .account-row label {
    min-width: 10rem;
    text-align: right;
  }

  .account-row :global(.wrapper) {
    flex: 1;
  }

  .required {
    color: var(--color-amount-negative);
  }

  /* --- Parse error list --- */

  .parse-errors {
    font-size: var(--text-sm);
    color: var(--color-danger);
    background: var(--color-danger-light);
    box-shadow: var(--shadow-sunken);
    padding: var(--sp-xs) var(--sp-sm);
    margin-bottom: var(--sp-md);
  }

  .parse-errors p {
    margin: 0 0 var(--sp-xs);
    font-weight: var(--weight-semibold);
  }

  .parse-errors ul {
    margin: 0;
    padding-left: var(--sp-md);
  }

  /* --- Preview table --- */

  .table-container {
    box-shadow: var(--shadow-sunken);
    background: var(--color-window-inset);
    margin-bottom: var(--sp-md);
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  /* Column header — each th gets a raised bevel like a classic listview header button */
  th {
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
    padding: var(--sp-xs) var(--sp-sm);
    text-align: left;
    font-weight: var(--weight-semibold);
    white-space: nowrap;
    /* Ensure headers sit above scrolled content */
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

  /* Column sizing hints */
  .col-description {
    width: 100%;
  } /* takes remaining space */
  .col-amount {
    width: 7rem;
  }
  .col-offset {
    min-width: 18rem;
  }

  /* Mono font for ledger-style data */
  .cell-mono {
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .cell-amount {
    font-family: var(--font-mono);
    text-align: right;
    white-space: nowrap;
  }

  .cell-amount.positive {
    color: var(--color-amount-positive);
  }
  .cell-amount.negative {
    color: var(--color-amount-negative);
  }

  /* Remove cell padding so the input sits flush in the offset column */
  .cell-offset {
    padding: 0;
  }

  /* --- Footer --- */

  .summary {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin-bottom: var(--sp-sm);
  }

  .actions {
    display: flex;
    gap: var(--sp-sm);
  }
</style>
