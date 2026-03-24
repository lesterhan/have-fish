<script lang="ts">
  import { onMount } from "svelte";
  import {
    fetchAccounts,
    fetchUserSettings,
    importPreview,
    importCommit,
    createAccount,
    type Account,
    type ImportPreviewResult,
    type CommitTransaction,
    type UserSettings,
  } from "$lib/api";
  import Button from "$lib/components/Button.svelte";
  import AccountPathInput from "$lib/components/AccountPathInput.svelte";

  let accounts = $state<Account[]>([]);
  let userSettings = $state<UserSettings | null>(null);
  // toAccountId seeds the offsetAccountId for regular rows on preview load.
  // Not required upfront — multi-currency imports may have no regular rows.
  let toAccountId = $state("");
  let fromAccountId = $state("");
  let defaultCurrency = $state("CAD");
  let file = $state<File | null>(null);
  let loading = $state(false);
  let error = $state("");
  let noParserFound = $state(false);
  let imported = $state<number | null>(null);

  let preview = $state<ImportPreviewResult | null>(null);

  // Per-row account state. Indexed to preview.transactions.
  type RowState = {
    offsetAccountId: string      // regular rows: the balancing account
    conversionAccountId: string  // transfer rows: equity:conversion account
    feeAccountId: string         // transfer rows: fee expense account
  }
  let rowStates = $state<RowState[]>([]);

  onMount(async () => {
    const [accts, settings] = await Promise.all([
      fetchAccounts(),
      fetchUserSettings(),
    ]);
    accounts = accts;
    userSettings = settings;
    toAccountId = settings.defaultOffsetAccountId ?? "";
  });

  // --- Multi-currency derived values ---

  // Path of the root account for this parser (e.g. "assets:wise").
  // Only set when the parser is multi-currency and the root account exists.
  let rootPath = $derived.by(() => {
    if (!preview?.isMultiCurrency || !preview.defaultAccountId) return null;
    return accounts.find((a) => a.id === preview!.defaultAccountId)?.path ?? null;
  });

  // All account paths that the import needs to exist (inferred from root + currencies).
  let inferredPaths = $derived.by(() => {
    if (!preview?.isMultiCurrency || !rootPath) return [];
    const paths = new Set<string>();
    for (const tx of preview.transactions) {
      if (tx.isTransfer) {
        paths.add(`${rootPath}:${tx.sourceCurrency.toLowerCase()}`);
        paths.add(`${rootPath}:${tx.targetCurrency.toLowerCase()}`);
      } else {
        const currency = tx.currency ?? defaultCurrency;
        paths.add(`${rootPath}:${currency.toLowerCase()}`);
      }
    }
    return [...paths];
  });

  // Subset of inferredPaths that don't yet exist in accounts.
  let missingPaths = $derived(
    inferredPaths.filter((path) => !accounts.some((a) => a.path === path))
  );

  // Returns the account ID for a child account at root:currency.
  // Returns '' if the account doesn't exist yet.
  function getInferredAccountId(currency: string): string {
    if (!rootPath) return "";
    const path = `${rootPath}:${currency.toLowerCase()}`;
    return accounts.find((a) => a.path === path)?.id ?? "";
  }

  // --- Account creation helpers ---

  function handleAccountCreated(account: { id: string; path: string }) {
    accounts = [...accounts, account];
  }

  async function handleCreateMissingAccount(path: string) {
    const created = await createAccount({ path });
    accounts = [...accounts, created];
  }

  async function handleCreateAllMissing() {
    for (const path of missingPaths) {
      await handleCreateMissingAccount(path);
    }
  }

  // --- Preview ---

  async function handleSubmit() {
    if (!file || !defaultCurrency) {
      error = "File and default currency are required.";
      return;
    }
    error = "";
    noParserFound = false;
    loading = true;
    try {
      preview = await importPreview(file, defaultCurrency);
      if (!preview.isMultiCurrency) {
        fromAccountId = preview.defaultAccountId ?? "";
      }
      rowStates = preview.transactions.map(() => ({
        offsetAccountId: toAccountId,
        conversionAccountId: userSettings?.defaultConversionAccountId ?? "",
        feeAccountId: preview!.defaultFeeAccountId ?? "",
      }));
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

  // --- Commit ---

  async function handleConfirm() {
    if (!preview) return;
    if (!preview.isMultiCurrency && !fromAccountId) {
      error = "From account is required.";
      return;
    }
    if (missingPaths.length > 0) {
      error = "Please create all required accounts before importing.";
      return;
    }
    const invalid = preview.transactions.some((tx, i) => {
      const row = rowStates[i];
      if (tx.isTransfer) return !row.conversionAccountId || !row.feeAccountId;
      return !row.offsetAccountId;
    });
    if (invalid) {
      error = "All transactions must have accounts assigned.";
      return;
    }
    loading = true;
    error = "";
    try {
      const txs: CommitTransaction[] = preview.transactions.map((tx, i) => {
        const row = rowStates[i];
        if (tx.isTransfer) {
          return {
            ...tx,
            sourceAccountId: getInferredAccountId(tx.sourceCurrency),
            targetAccountId: getInferredAccountId(tx.targetCurrency),
            conversionAccountId: row.conversionAccountId,
            feeAccountId: row.feeAccountId,
          };
        } else {
          return {
            ...tx,
            offsetAccountId: row.offsetAccountId,
            ...(preview!.isMultiCurrency
              ? { sourceAccountId: getInferredAccountId(tx.currency ?? defaultCurrency) }
              : {}),
          };
        }
      });
      const result = await importCommit({
        accountId: fromAccountId,
        defaultCurrency,
        transactions: txs,
      });
      imported = result.created;
      preview = null;
      rowStates = [];
    } catch (e) {
      error = "Import failed. Please try again.";
    } finally {
      loading = false;
    }
  }

  function handleCancel() {
    preview = null;
    fromAccountId = "";
    rowStates = [];
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

  {#if !preview.isMultiCurrency}
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
  {/if}

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

  {#if missingPaths.length > 0}
    <div class="missing-accounts-banner">
      <span class="missing-label">Accounts needed:</span>
      {#each missingPaths as path}
        <span class="missing-account">
          <code>{path}</code>
          <button class="create-btn" onclick={() => handleCreateMissingAccount(path)}>
            Create
          </button>
        </span>
      {/each}
      <button class="create-all-btn" onclick={handleCreateAllMissing}>
        Create all
      </button>
    </div>
  {/if}

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th class="col-description">Description</th>
          <th class="col-amount">Amount</th>
          {#if !preview.isMultiCurrency}<th>Currency</th>{/if}
          <th class="col-offset">To account</th>
        </tr>
      </thead>
      <tbody>
        {#each preview.transactions as tx, i}
          {#if tx.isTransfer}
            <tr class="row-transfer">
              <td class="cell-mono">{new Date(tx.date).toLocaleDateString()}</td>
              <td>{tx.description ?? "—"}</td>
              <td class="cell-transfer-amount">
                <span class="transfer-from">{tx.sourceAmount} {tx.sourceCurrency}</span>
                <span class="transfer-arrow">→</span>
                <span class="transfer-to">{tx.targetAmount} {tx.targetCurrency}</span>
                {#if tx.feeAmount}
                  <span class="transfer-fee">
                    fee: {tx.feeAmount} {tx.feeCurrency ?? tx.sourceCurrency}
                  </span>
                {/if}
              </td>
              <td class="cell-offset">
                <div class="transfer-accounts">
                  <AccountPathInput
                    {accounts}
                    bind:value={rowStates[i].conversionAccountId}
                    placeholder="equity:conversion…"
                    oncreate={handleAccountCreated}
                  />
                  <AccountPathInput
                    {accounts}
                    bind:value={rowStates[i].feeAccountId}
                    placeholder="expenses:fees…"
                    oncreate={handleAccountCreated}
                  />
                </div>
              </td>
            </tr>
          {:else}
            <tr>
              <td class="cell-mono">{new Date(tx.date).toLocaleDateString()}</td>
              <td>{tx.description ?? "—"}</td>
              <td
                class="cell-amount"
                class:positive={parseFloat(tx.amount) > 0}
                class:negative={parseFloat(tx.amount) < 0}
              >
                {tx.amount}{#if preview.isMultiCurrency} {tx.currency ?? defaultCurrency}{/if}
              </td>
              {#if !preview.isMultiCurrency}<td>{tx.currency ?? defaultCurrency}</td>{/if}
              <td class="cell-offset">
                <AccountPathInput
                  {accounts}
                  bind:value={rowStates[i].offsetAccountId}
                  placeholder="Select or create…"
                  oncreate={handleAccountCreated}
                />
              </td>
            </tr>
          {/if}
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
        missingPaths.length > 0 ||
        (!preview.isMultiCurrency && !fromAccountId) ||
        rowStates.some((row, i) => {
          const tx = preview!.transactions[i];
          if (tx.isTransfer) return !row.conversionAccountId || !row.feeAccountId;
          return !row.offsetAccountId;
        })}
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

  /* --- Missing accounts banner --- */

  .missing-accounts-banner {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
    margin-bottom: var(--sp-md);
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
    font-size: var(--text-sm);
  }

  .missing-label {
    font-weight: var(--weight-semibold);
    margin-right: var(--sp-xs);
  }

  .missing-account {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: var(--color-window-raised);
    box-shadow: var(--shadow-sunken);
    padding: 0 var(--sp-xs);
  }

  .missing-account code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .create-btn,
  .create-all-btn {
    font-family: inherit;
    font-size: var(--text-xs);
    padding: 1px var(--sp-xs);
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
    border: none;
    cursor: pointer;
    color: var(--color-text);
    transition: box-shadow var(--duration-fast) var(--ease);
  }

  .create-btn:active,
  .create-all-btn:active {
    box-shadow: var(--shadow-sunken);
  }

  .create-all-btn {
    margin-left: auto;
    font-weight: var(--weight-semibold);
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
  }
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

  /* --- Transfer rows --- */

  .row-transfer td {
    background: var(--color-window);
  }

  .row-transfer:hover td {
    background: var(--color-accent-light);
  }

  .cell-transfer-amount {
    font-family: var(--font-mono);
    white-space: nowrap;
    padding: var(--sp-xs) var(--sp-sm);
  }

  .transfer-from {
    color: var(--color-amount-negative);
  }

  .transfer-arrow {
    color: var(--color-text-muted);
    margin: 0 var(--sp-xs);
  }

  .transfer-to {
    color: var(--color-amount-positive);
  }

  .transfer-fee {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-top: 1px;
  }

  /* Two AccountPathInputs stacked for conversion + fee accounts */
  .transfer-accounts {
    display: flex;
    flex-direction: column;
  }

  .transfer-accounts :global(.wrapper:first-child .path-input) {
    border-bottom: 1px solid var(--color-bevel-mid);
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
