<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchAccounts, importPreview, importCommit, type ImportPreviewResult } from '$lib/api'
  import Button from '$lib/components/Button.svelte'

  let accounts = $state<Awaited<ReturnType<typeof fetchAccounts>>>([])
  let sourceAccountId = $state('')
  let offsetAccountId = $state('')
  let defaultCurrency = $state('CAD')
  let file = $state<File | null>(null)
  let loading = $state(false)
  let error = $state('')
  let noParserFound = $state(false)
  let imported = $state<number | null>(null)

  let preview = $state<ImportPreviewResult | null>(null)

  onMount(async () => {
    accounts = await fetchAccounts()
  })

  async function handleConfirm() {
    if (!preview) return
    if (!sourceAccountId || !offsetAccountId) {
      error = 'Source and offset accounts are required.'
      return
    }
    loading = true
    error = ''
    try {
      const result = await importCommit({
        accountId: sourceAccountId,
        offsetAccountId,
        defaultCurrency,
        transactions: preview.transactions,
      })
      imported = result.created
      preview = null
    } catch (e) {
      error = 'Import failed. Please try again.'
    } finally {
      loading = false
    }
  }

  async function handleSubmit() {
    if (!file || !offsetAccountId || !defaultCurrency) {
      error = 'All fields are required.'
      return
    }
    error = ''
    noParserFound = false
    loading = true
    try {
      preview = await importPreview(file, defaultCurrency)
      // Pre-fill source account from the matched parser's default, if set
      sourceAccountId = preview.defaultAccountId ?? ''
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to parse the CSV. Please check the file and try again.'
      noParserFound = error.toLowerCase().includes('no saved parser')
    } finally {
      loading = false
    }
  }
</script>

<h1>Import</h1>

{#if !preview}
  <form onsubmit={(e) => { e.preventDefault(); handleSubmit() }}>
    <label>
      Offset account
      <select bind:value={offsetAccountId} required>
        <option value="">Select an account…</option>
        {#each accounts as account}
          <option value={account.id}>{account.path}</option>
        {/each}
      </select>
    </label>

    <label>
      Default currency
      <input type="text" bind:value={defaultCurrency} placeholder="CAD" required />
    </label>

    <label>
      CSV file
      <input
        type="file"
        accept=".csv"
        onchange={(e) => { file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null }}
        required
      />
    </label>

    {#if error}
      <p class="error">{error}</p>
      {#if noParserFound}
        <p class="hint">Go to <a href="/settings">Settings</a> to create a parser for this file.</p>
      {/if}
    {/if}

    <Button type="submit" variant="primary" disabled={loading}>
      {loading ? 'Parsing…' : 'Preview import'}
    </Button>
  </form>
{:else}
  <h2>Preview</h2>
  <p class="parser-tag">Parser: <strong>{preview.parser}</strong></p>

  <div class="account-row">
    <label for="source-account">
      Source account
      {#if !sourceAccountId}<span class="required">*</span>{/if}
    </label>
    <select id="source-account" bind:value={sourceAccountId}>
      <option value="">Select an account…</option>
      {#each accounts as account}
        <option value={account.id}>{account.path}</option>
      {/each}
    </select>
  </div>

  {#if preview.errors.length > 0}
    <p class="error">{preview.errors.length} row(s) could not be parsed and will be skipped.</p>
    <ul class="error">
      {#each preview.errors as e}
        <li>Row {e.row}: {e.reason}</li>
      {/each}
    </ul>
  {/if}

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Description</th>
        <th>Amount</th>
        <th>Currency</th>
      </tr>
    </thead>
    <tbody>
      {#each preview.transactions as tx}
        <tr>
          <td>{new Date(tx.date).toLocaleDateString()}</td>
          <td>{tx.description}</td>
          <td>{tx.amount}</td>
          <td>{tx.currency ?? defaultCurrency}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <p>{preview.transactions.length} transaction(s) ready to import.</p>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <Button onclick={() => { preview = null; sourceAccountId = '' }}>Cancel</Button>
  <Button
    variant="primary"
    onclick={handleConfirm}
    disabled={loading || preview.transactions.length === 0 || !sourceAccountId}
  >
    {loading ? 'Importing…' : 'Confirm import'}
  </Button>
{/if}

{#if imported !== null}
  <p>{imported} transaction(s) imported successfully. <a href="/transactions">View transactions</a></p>
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

  .account-row select {
    flex: 1;
    font-size: var(--text-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-raised);
    box-shadow: var(--shadow-sunken);
    border: none;
    color: var(--color-text);
    font-family: inherit;
  }

  .account-row select:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .required {
    color: var(--color-amount-negative);
  }
</style>
