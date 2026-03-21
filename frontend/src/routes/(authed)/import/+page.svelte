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

  // Populated after the user submits the form — hands off to the preview/confirm section below
  let preview = $state<ImportPreviewResult | null>(null)

  onMount(async () => {
    accounts = await fetchAccounts()
  })

  async function handleConfirm() {
    if (!preview) return
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
    if (!file || !sourceAccountId || !offsetAccountId || !defaultCurrency) {
      error = 'All fields are required.'
      return
    }
    error = ''
    noParserFound = false
    loading = true
    try {
      preview = await importPreview(file, sourceAccountId, defaultCurrency)
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
      Source account
      <select bind:value={sourceAccountId} required>
        <option value="">Select an account…</option>
        {#each accounts as account}
          <option value={account.id}>{account.path}</option>
        {/each}
      </select>
    </label>

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

  <Button onclick={() => { preview = null }}>Cancel</Button>
  <Button variant="primary" onclick={handleConfirm} disabled={loading || preview.transactions.length === 0}>
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
</style>
