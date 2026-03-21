<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchAccounts, createAccount, deleteAccount, fetchParsers, createParser, deleteParser } from '$lib/api'
  import type { CsvParser } from '$lib/api'
  import Button from '$lib/components/Button.svelte'

  // --- Accounts ---
  let accounts = $state<Awaited<ReturnType<typeof fetchAccounts>>>([])
  let newAccountPath = $state('')

  onMount(async () => {
    accounts = await fetchAccounts()
    parsers = await fetchParsers()
  })

  async function handleCreateAccount() {
    const created = await createAccount({ path: newAccountPath })
    accounts = [...accounts, created]
    newAccountPath = ''
  }

  async function handleDeleteAccount(id: string) {
    await deleteAccount(id)
    accounts = accounts.filter((a: { id: string }) => a.id !== id)
  }

  // --- Import parsers ---
  let parsers = $state<CsvParser[]>([])

  // Step 1: raw header input
  let headerInput = $state('')

  // Step 2: normalized column names extracted from the header input.
  // Empty array = step 1 is active. Populated = step 2 (mapping) is active.
  let columns = $state<string[]>([])

  // Mapping form state
  let parserName = $state('')
  let mappingDate = $state('')
  let mappingAmount = $state('')
  let mappingDescription = $state<string>('')
  let mappingCurrency = $state<string>('')

  // Applies the same normalization as the backend's parseCsv transformHeader:
  // lowercase, strip whitespace, strip parenthetical suffixes.
  function normalizeColumn(col: string): string {
    return col.toLowerCase().replace(/\s/g, '').replace(/\(.*\)/g, '')
  }

  // Sorted pipe-joined fingerprint — must match what the backend stores.
  function buildNormalizedHeader(cols: string[]): string {
    return [...cols].sort().join('|')
  }

  function handleParseHeader() {
    const parsed = headerInput
      .split(',')
      .map((c) => normalizeColumn(c.trim()))
      .filter(Boolean)
    columns = [...new Set(parsed)] // deduplicate in case of malformed input
    mappingDate = ''
    mappingAmount = ''
    mappingDescription = ''
    mappingCurrency = ''
  }

  function handleReset() {
    columns = []
    headerInput = ''
    parserName = ''
  }

  async function handleSaveParser() {
    const columnMapping = {
      date: mappingDate,
      amount: mappingAmount,
      description: mappingDescription || null,
      currency: mappingCurrency || null,
    }
    const created = await createParser({
      name: parserName,
      normalizedHeader: buildNormalizedHeader(columns),
      columnMapping,
    })
    parsers = [...parsers, created]
    handleReset()
  }

  async function handleDeleteParser(id: string) {
    await deleteParser(id)
    parsers = parsers.filter((p) => p.id !== id)
  }


</script>

<h1>Settings</h1>

<section>
  <h2>Accounts</h2>
  <form onsubmit={(e) => { e.preventDefault(); handleCreateAccount() }}>
    <input bind:value={newAccountPath} placeholder="assets:cash" />
    <Button type="submit" variant="primary">Add Account</Button>
  </form>

  {#each accounts as account}
    <div class="list-row">
      {account.path}
      <Button variant="danger" onclick={() => handleDeleteAccount(account.id)}>delete</Button>
    </div>
  {/each}
</section>

<section>
  <h2>Import Parsers</h2>

  {#if parsers.length === 0}
    <p class="empty">No parsers saved yet.</p>
  {:else}
    {#each parsers as parser}
      <div class="list-row">
        <span class="parser-name">{parser.name}</span>
        <span class="parser-header">{parser.normalizedHeader}</span>
        <Button variant="danger" onclick={() => handleDeleteParser(parser.id)}>delete</Button>
      </div>
    {/each}
  {/if}

  <div class="parser-form">
    {#if columns.length === 0}
      <!-- Step 1: paste header row -->
      <h3>New parser</h3>
      <p class="hint">Paste the first line of your bank's CSV export.</p>
      <div class="row">
        <input
          class="header-input"
          bind:value={headerInput}
          placeholder="Date, Amount (CAD), Description, Currency"
        />
        <Button variant="primary" onclick={handleParseHeader} disabled={!headerInput.trim()}>
          Parse columns
        </Button>
      </div>
    {:else}
      <!-- Step 2: map columns to fields -->
      <h3>Map columns</h3>
      <p class="hint">Detected columns: <code>{columns.join(', ')}</code></p>

      <div class="mapping-grid">
        <label for="map-date">Date <span class="required">*</span></label>
        <select id="map-date" bind:value={mappingDate}>
          <option value="">— select —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-amount">Amount <span class="required">*</span></label>
        <select id="map-amount" bind:value={mappingAmount}>
          <option value="">— select —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-description">Description</label>
        <select id="map-description" bind:value={mappingDescription}>
          <option value="">— not mapped —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="map-currency">Currency</label>
        <select id="map-currency" bind:value={mappingCurrency}>
          <option value="">— not mapped —</option>
          {#each columns as col}<option value={col}>{col}</option>{/each}
        </select>

        <label for="parser-name">Parser name <span class="required">*</span></label>
        <input id="parser-name" bind:value={parserName} placeholder="Imre Trust Credit Union" />
      </div>

      <div class="row">
        <Button
          variant="primary"
          onclick={handleSaveParser}
          disabled={!parserName.trim() || !mappingDate || !mappingAmount}
        >
          Save parser
        </Button>
        <Button onclick={handleReset}>Start over</Button>
      </div>
    {/if}
  </div>
</section>

<style>
  section {
    margin-bottom: var(--sp-xl);
  }

  h2 {
    font-size: var(--text-sm);
    font-weight: bold;
    margin-bottom: var(--sp-sm);
    padding-bottom: var(--sp-xs);
    border-bottom: 1px solid var(--color-border);
  }

  h3 {
    font-size: var(--text-sm);
    font-weight: bold;
    margin-bottom: var(--sp-xs);
  }

  .list-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) 0;
    border-bottom: 1px solid var(--color-border);
    font-size: var(--text-sm);
  }

  .parser-name {
    font-weight: bold;
    min-width: 10rem;
  }

  .parser-header {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin-bottom: var(--sp-md);
  }

  .hint {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin-bottom: var(--sp-sm);
  }

  .hint code {
    font-family: monospace;
    background: var(--color-window);
    box-shadow: var(--shadow-sunken);
    padding: 0 var(--sp-xs);
  }

  .parser-form {
    margin-top: var(--sp-md);
    padding: var(--sp-md);
    background: var(--color-window);
    box-shadow: var(--shadow-sunken);
  }

  .row {
    display: flex;
    gap: var(--sp-sm);
    align-items: center;
  }

  .header-input {
    flex: 1;
  }

  .mapping-grid {
    display: grid;
    grid-template-columns: 10rem 1fr;
    gap: var(--sp-xs) var(--sp-sm);
    align-items: center;
    margin-bottom: var(--sp-md);
  }

  .mapping-grid label {
    font-size: var(--text-sm);
    text-align: right;
  }

  .required {
    color: var(--color-amount-negative);
  }

  select,
  input {
    font-size: var(--text-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-raised);
    box-shadow: var(--shadow-sunken);
    border: none;
    color: var(--color-text);
    font-family: inherit;
    width: 100%;
  }

  select:focus,
  input:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }
</style>
