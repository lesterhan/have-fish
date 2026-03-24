<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchAccounts, createAccount, deleteAccount, fetchParsers, createParser, deleteParser, updateParser, fetchUserSettings, updateUserSettings } from '$lib/api'
  import type { Account, CsvParser, UserSettings } from '$lib/api'
  import Button from '$lib/components/Button.svelte'
  import AccountPathInput from '$lib/components/AccountPathInput.svelte'
  import { signOut, useSession } from '$lib/auth'
  import { goto } from '$app/navigation'

  const session = useSession()

  async function handleSignOut() {
    await signOut()
    goto('/login')
  }

  // --- Defaults ---
  let userSettings = $state<UserSettings | null>(null)

  // --- Accounts ---
  let accounts = $state<Account[]>([])
  let newAccountPath = $state('')

  onMount(async () => {
    const [accts, parsersData, settings] = await Promise.all([
      fetchAccounts(),
      fetchParsers(),
      fetchUserSettings(),
    ])
    accounts = accts
    parsers = parsersData
    userSettings = settings
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
  // Multi-currency fields
  let isMultiCurrency = $state(false)
  let mappingSourceAmount = $state('')
  let mappingSourceCurrency = $state('')
  let mappingTargetAmount = $state('')
  let mappingTargetCurrency = $state('')
  let mappingFeeAmount = $state('')
  let mappingFeeCurrency = $state('')
  let newParserFeeAccountId = $state('')

  // Applies the same normalization as the backend's parseCsv transformHeader:
  // lowercase, strip whitespace, strip parenthetical suffixes.
  function normalizeColumn(col: string): string {
    return col.toLowerCase().replace(/"/g, '').replace(/\s/g, '').replace(/\(.*\)/g, '')
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
    isMultiCurrency = false
    mappingSourceAmount = ''
    mappingSourceCurrency = ''
    mappingTargetAmount = ''
    mappingTargetCurrency = ''
    mappingFeeAmount = ''
    mappingFeeCurrency = ''
    newParserFeeAccountId = ''
  }

  async function handleSaveParser() {
    const columnMapping = {
      date: mappingDate,
      amount: mappingAmount,
      description: mappingDescription || null,
      currency: mappingCurrency || null,
      ...(isMultiCurrency && {
        sourceAmount: mappingSourceAmount || null,
        sourceCurrency: mappingSourceCurrency || null,
        targetAmount: mappingTargetAmount || null,
        targetCurrency: mappingTargetCurrency || null,
        feeAmount: mappingFeeAmount || null,
        feeCurrency: mappingFeeCurrency || null,
      }),
    }
    const created = await createParser({
      name: parserName,
      normalizedHeader: buildNormalizedHeader(columns),
      columnMapping,
      isMultiCurrency,
      defaultFeeAccountId: newParserFeeAccountId || null,
    })
    parsers = [...parsers, created]
    handleReset()
  }

  async function handleDeleteParser(id: string) {
    await deleteParser(id)
    parsers = parsers.filter((p) => p.id !== id)
  }

  async function handleParserAccountChange(id: string, accountId: string) {
    // Empty string from the dropdown means "no default" — send null to clear it
    const updated = await updateParser(id, { defaultAccountId: accountId || null })
    parsers = parsers.map((p) => (p.id === id ? updated : p))
  }

  async function handleParserMultiCurrencyChange(id: string, value: boolean) {
    const updated = await updateParser(id, { isMultiCurrency: value })
    parsers = parsers.map((p) => (p.id === id ? updated : p))
  }

  async function handleParserFeeAccountChange(id: string, accountId: string) {
    const updated = await updateParser(id, { defaultFeeAccountId: accountId || null })
    parsers = parsers.map((p) => (p.id === id ? updated : p))
  }

  async function handleDefaultChange(field: 'defaultOffsetAccountId' | 'defaultConversionAccountId', accountId: string) {
    userSettings = await updateUserSettings({ [field]: accountId || null })
  }

  async function handleAssetsRootPathChange(value: string) {
    if (!value.trim()) return
    userSettings = await updateUserSettings({ defaultAssetsRootPath: value.trim() })
  }

</script>

{#if $session.data}
  <div class="user-banner">
    <h1>🧧🎣 {$session.data.user.email}</h1>
    <Button variant="danger" onclick={handleSignOut}>Sign out</Button>
  </div>
{/if}

<section>
  <h2>Defaults</h2>
  <div class="defaults-grid">
    <label for="default-offset">Offset account</label>
    <select
      id="default-offset"
      value={userSettings?.defaultOffsetAccountId ?? ''}
      onchange={(e) => handleDefaultChange('defaultOffsetAccountId', (e.currentTarget as HTMLSelectElement).value)}
    >
      <option value="">— none —</option>
      {#each accounts as account}
        <option value={account.id}>{account.path}</option>
      {/each}
    </select>

    <label for="default-conversion">Conversion account</label>
    <select
      id="default-conversion"
      value={userSettings?.defaultConversionAccountId ?? ''}
      onchange={(e) => handleDefaultChange('defaultConversionAccountId', (e.currentTarget as HTMLSelectElement).value)}
    >
      <option value="">— none —</option>
      {#each accounts as account}
        <option value={account.id}>{account.path}</option>
      {/each}
    </select>

    <label for="assets-root-path">Assets root path</label>
    <input
      id="assets-root-path"
      type="text"
      value={userSettings?.defaultAssetsRootPath ?? 'assets'}
      onblur={(e) => handleAssetsRootPathChange((e.currentTarget as HTMLInputElement).value)}
      placeholder="assets"
    />
  </div>
</section>

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
        <label class="multi-currency-toggle" title="Enables support for inline multi-currency transfers (e.g. Wise)">
          <input
            type="checkbox"
            checked={parser.isMultiCurrency}
            onchange={(e) => handleParserMultiCurrencyChange(parser.id, (e.currentTarget as HTMLInputElement).checked)}
          />
          multi-currency
        </label>
        <select
          class="parser-account"
          value={parser.defaultAccountId ?? ''}
          title={parser.isMultiCurrency ? 'Root path (e.g. assets:wise)' : 'Default account'}
          onchange={(e) => handleParserAccountChange(parser.id, (e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">{parser.isMultiCurrency ? '— no root path —' : '— no default —'}</option>
          {#each accounts as account}
            <option value={account.id}>{account.path}</option>
          {/each}
        </select>
        {#if parser.isMultiCurrency}
          <select
            class="parser-account"
            value={parser.defaultFeeAccountId ?? ''}
            title="Default fee account"
            onchange={(e) => handleParserFeeAccountChange(parser.id, (e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">— no fee account —</option>
            {#each accounts as account}
              <option value={account.id}>{account.path}</option>
            {/each}
          </select>
        {/if}
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

        <label for="multi-currency" class="checkbox-label">
          Multi-currency
          <span class="tooltip-icon" title="Enables support for inline multi-currency transfers (e.g. Wise). The default account becomes the root path (e.g. assets:wise) and child accounts are derived per row.">?</span>
        </label>
        <input id="multi-currency" type="checkbox" class="checkbox" bind:checked={isMultiCurrency} />

        {#if isMultiCurrency}
          <label for="map-source-amount">Source amount <span class="required">*</span></label>
          <select id="map-source-amount" bind:value={mappingSourceAmount}>
            <option value="">— select —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="map-source-currency">Source currency <span class="required">*</span></label>
          <select id="map-source-currency" bind:value={mappingSourceCurrency}>
            <option value="">— select —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="map-target-amount">Target amount <span class="required">*</span></label>
          <select id="map-target-amount" bind:value={mappingTargetAmount}>
            <option value="">— select —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="map-target-currency">Target currency <span class="required">*</span></label>
          <select id="map-target-currency" bind:value={mappingTargetCurrency}>
            <option value="">— select —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="map-fee-amount">Fee amount</label>
          <select id="map-fee-amount" bind:value={mappingFeeAmount}>
            <option value="">— not mapped —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label for="map-fee-currency">Fee currency</label>
          <select id="map-fee-currency" bind:value={mappingFeeCurrency}>
            <option value="">— not mapped —</option>
            {#each columns as col}<option value={col}>{col}</option>{/each}
          </select>

          <label>Default fee account</label>
          <AccountPathInput
            {accounts}
            bind:value={newParserFeeAccountId}
            placeholder="expenses:fees:wise"
            oncreate={(a) => { accounts = [...accounts, a] }}
          />
        {/if}

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
  .user-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-md);
    margin-bottom: var(--sp-xl);
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
  }

  .user-banner h1 {
    font-size: var(--text-base);
    font-weight: bold;
  }

  .defaults-grid {
    display: grid;
    grid-template-columns: 12rem 1fr;
    gap: var(--sp-xs) var(--sp-sm);
    align-items: center;
  }

  .defaults-grid label {
    font-size: var(--text-sm);
    text-align: right;
  }

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

  .parser-account {
    font-size: var(--text-xs);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-raised);
    box-shadow: var(--shadow-sunken);
    border: none;
    color: var(--color-text);
    font-family: inherit;
    min-width: 12rem;
  }

  .parser-account:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
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

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    justify-content: flex-end;
  }

  .checkbox {
    width: auto;
    box-shadow: none;
    padding: 0;
    cursor: pointer;
  }

  .tooltip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-text-muted);
    color: var(--color-window);
    font-size: 10px;
    font-weight: bold;
    cursor: help;
    flex-shrink: 0;
  }

  .multi-currency-toggle {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    cursor: pointer;
    white-space: nowrap;
  }

  .multi-currency-toggle input {
    width: auto;
    box-shadow: none;
    padding: 0;
    cursor: pointer;
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
