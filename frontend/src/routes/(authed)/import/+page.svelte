<script lang="ts">
  import { onMount } from 'svelte'
  import {
    fetchAccounts,
    fetchParsers,
    importPreview,
    importCommit,
    createAccount,
    type Account,
    type CsvParser,
    type CommitTransaction,
  } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import EditParserPanel from '$lib/components/import/EditParserPanel.svelte'
  import AddParserWizard from '$lib/components/wizards/AddParserWizard.svelte'
  import ImportPreviewPanel from '$lib/components/import/ImportPreviewPanel.svelte'
  import ParsersPanel from '$lib/components/import/ParsersPanel.svelte'
  import type { RowState } from '$lib/components/import/ImportPreviewPanel.svelte'
  import { toast } from '$lib/toast.svelte'
  import { goto } from '$app/navigation'
  import { confetti } from '$lib/confetti.svelte'
  import { bump as refreshSidebar } from '$lib/sidebarRefresh.svelte'

  let accounts = $state<Account[]>([])
  let parsers = $state<CsvParser[]>([])
  let parsersLoading = $state(true)
  // toAccountId seeds the offsetAccountId for regular rows on preview load.
  // Not required upfront — multi-currency imports may have no regular rows.
  let toAccountId = $state('')
  let fromAccountId = $state('')
  let defaultCurrency = $state('CAD')
  let file = $state<File | null>(null)
  let dragOver = $state(false)
  let loading = $state(false)
  let error = $state('')
  let noParserFound = $state(false)

  let preview = $state<Awaited<ReturnType<typeof importPreview>> | null>(null)
  let importAsLiabilities = $state(false)

  let editingParser = $state<CsvParser | null>(null)
  let showAddParser = $state(false)

  let rowStates = $state<RowState[]>([])

  onMount(async () => {
    const [accts, settings, parsersData] = await Promise.all([
      fetchAccounts(),
      settingsStore.load(),
      fetchParsers(),
    ])
    accounts = accts
    parsers = parsersData
    parsersLoading = false
    toAccountId = settings.defaultOffsetAccountId ?? ''
  })

  // --- Multi-currency derived values ---

  let rootPath = $derived.by(() => {
    if (!preview?.isMultiCurrency || !preview.defaultAccountId) return null
    return (
      accounts.find((a) => a.id === preview!.defaultAccountId)?.path ?? null
    )
  })

  let inferredPaths = $derived.by(() => {
    if (!preview?.isMultiCurrency || !rootPath) return []
    const paths = new Set<string>()
    for (const tx of preview.transactions) {
      if (tx.isTransfer === true) {
        paths.add(`${rootPath}:${tx.sourceCurrency.toLowerCase()}`)
        paths.add(`${rootPath}:${tx.targetCurrency.toLowerCase()}`)
      } else {
        const currency = tx.currency ?? defaultCurrency
        paths.add(`${rootPath}:${currency.toLowerCase()}`)
      }
    }
    return [...paths]
  })

  let missingPaths = $derived(
    inferredPaths.filter((path) => !accounts.some((a) => a.path === path)),
  )

  function getInferredAccountId(currency: string): string {
    if (!rootPath) return ''
    const path = `${rootPath}:${currency.toLowerCase()}`
    return accounts.find((a) => a.path === path)?.id ?? ''
  }

  // --- Account creation helpers ---

  function handleAccountCreated(account: Account) {
    accounts = [...accounts, account]
  }

  async function handleCreateMissingAccount(path: string) {
    const created = await createAccount({ path })
    accounts = [...accounts, created]
  }

  async function handleCreateAllMissing() {
    for (const path of missingPaths) {
      await handleCreateMissingAccount(path)
    }
  }

  // --- Preview ---

  async function handleSubmit() {
    if (!file || !defaultCurrency) {
      error = 'File and default currency are required.'
      return
    }
    error = ''
    noParserFound = false
    loading = true
    try {
      preview = await importPreview(file, defaultCurrency)
      if (!preview.isMultiCurrency) {
        fromAccountId = preview.defaultAccountId ?? ''
      }
      const liabilitiesRoot =
        settingsStore.value?.defaultLiabilitiesRootPath ?? 'liabilities'
      const defaultAccountPath =
        accounts.find((a) => a.id === preview!.defaultAccountId)?.path ?? ''
      importAsLiabilities = defaultAccountPath.startsWith(`${liabilitiesRoot}:`)
      rowStates = preview.transactions.map((tx) => ({
        offsetAccountId: toAccountId,
        conversionAccountId:
          settingsStore.value?.defaultConversionAccountId ?? '',
        feeAccountId: preview!.defaultFeeAccountId ?? '',
        skipped: tx.possibleDuplicate != null,
      }))
    } catch (e) {
      error =
        e instanceof Error
          ? e.message
          : 'Failed to parse the CSV. Please check the file and try again.'
      noParserFound = error.toLowerCase().includes('no saved parser')
    } finally {
      loading = false
    }
  }

  // --- Commit ---

  async function handleConfirm() {
    if (!preview) return
    if (!preview.isMultiCurrency && !fromAccountId) {
      error = 'From account is required.'
      return
    }
    if (missingPaths.length > 0) {
      error = 'Please create all required accounts before importing.'
      return
    }
    const invalid = preview.transactions.some((tx, i) => {
      const row = rowStates[i]
      if (row.skipped) return false
      if (tx.isTransfer === true)
        return !row.conversionAccountId || !row.feeAccountId
      if (tx.isTransfer === 'same-currency')
        return !row.feeAccountId || !row.offsetAccountId
      return !row.offsetAccountId
    })
    if (invalid) {
      error = 'All transactions must have accounts assigned.'
      return
    }
    loading = true
    error = ''
    try {
      const txs: CommitTransaction[] = preview.transactions.flatMap((tx, i) => {
        if (rowStates[i].skipped) return []
        const row = rowStates[i]
        if (tx.isTransfer === true) {
          return {
            ...tx,
            sourceAccountId: getInferredAccountId(tx.sourceCurrency),
            targetAccountId: getInferredAccountId(tx.targetCurrency),
            conversionAccountId: row.conversionAccountId,
            feeAccountId: row.feeAccountId,
          }
        } else if (tx.isTransfer === 'same-currency') {
          return {
            ...tx,
            targetAccountId: preview!.isMultiCurrency
              ? getInferredAccountId(tx.currency)
              : fromAccountId,
            sourceAccountId: row.offsetAccountId,
            feeAccountId: row.feeAccountId,
          }
        } else {
          const amount = importAsLiabilities
            ? String(-parseFloat(tx.amount))
            : tx.amount
          return {
            ...tx,
            amount,
            offsetAccountId: row.offsetAccountId,
            ...(preview!.isMultiCurrency
              ? {
                  sourceAccountId: getInferredAccountId(
                    tx.currency ?? defaultCurrency,
                  ),
                }
              : {}),
          }
        }
      })
      const result = await importCommit({
        accountId: fromAccountId,
        defaultCurrency,
        transactions: txs,
      })
      toast.show(`${result.created} transaction(s) imported`)
      refreshSidebar()
      confetti.trigger()
      goto('/transactions')
    } catch {
      error = 'Import failed. Please try again.'
    } finally {
      loading = false
    }
  }

  function handleCancel() {
    preview = null
    fromAccountId = ''
    rowStates = []
    importAsLiabilities = false
  }
</script>

<div class="page">
  {#if !preview}
    <form
      class="import-window"
      onsubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
    >
      <div class="section-bar">
        <span class="section-bar-title">IMPORT CSV</span>
      </div>

      <div class="import-body">
        <label
          class="drop-zone"
          class:has-file={!!file}
          class:drag-over={dragOver}
          ondragover={(e) => {
            e.preventDefault()
            dragOver = true
          }}
          ondragleave={() => {
            dragOver = false
          }}
          ondrop={(e) => {
            e.preventDefault()
            dragOver = false
            const f = e.dataTransfer?.files[0]
            if (f) file = f
          }}
        >
          {#if file}
            <span class="file-name">{file.name}</span>
            <span class="file-size">{(file.size / 1024).toFixed(1)} KB</span>
          {:else}
            <span class="drop-label">DROP CSV OR CLICK TO BROWSE</span>
            <span class="drop-hint">accepts .csv</span>
          {/if}
          <input
            id="csv-file"
            type="file"
            accept=".csv"
            class="file-input-hidden"
            onchange={(e) => {
              file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null
            }}
          />
        </label>

        <div class="config-strip">
          <div class="config-field">
            <span class="config-label">DEFAULT CURRENCY</span>
            <TextInput
              id="default-currency"
              bind:value={defaultCurrency}
              placeholder="CAD"
              style="width: 5rem"
              required
            />
          </div>
          <div class="config-field config-account">
            <span class="config-label">UNCATEGORIZED ACCOUNT</span>
            <AccountPathInput
              {accounts}
              bind:value={toAccountId}
              placeholder="Select or create an account…"
              oncreate={handleAccountCreated}
            />
          </div>
          <div class="config-submit">
            <GradientButton type="submit" disabled={loading}>
              {loading ? 'Parsing…' : 'Preview import'}
            </GradientButton>
          </div>
        </div>

        {#if error}
          <div class="error-strip">
            <span class="error-text">{error}</span>
            {#if noParserFound}
              <span class="hint-text">
                Go to <a href="/settings">Settings</a> to add a parser for this
                file.
              </span>
            {/if}
          </div>
        {/if}
      </div>
    </form>

    <div class="bottom-cols">
      <ParsersPanel
        {parsers}
        {accounts}
        loading={parsersLoading}
        onedit={(p) => {
          editingParser = p
        }}
        onadd={() => {
          showAddParser = true
        }}
      />
      {#if editingParser}
        <EditParserPanel
          parser={editingParser}
          {accounts}
          onSuccess={(updated) => {
            parsers = parsers.map((p) => (p.id === updated.id ? updated : p))
            editingParser = null
          }}
          onCancel={() => {
            editingParser = null
          }}
          onAccountCreated={handleAccountCreated}
        />
      {/if}
    </div>
  {:else}
    <ImportPreviewPanel
      {preview}
      bind:rowStates
      {accounts}
      bind:fromAccountId
      bind:importAsLiabilities
      {defaultCurrency}
      {loading}
      {error}
      {missingPaths}
      onaccountcreated={handleAccountCreated}
      oncreatemissing={handleCreateMissingAccount}
      oncreateallmissing={handleCreateAllMissing}
      onconfirm={handleConfirm}
      oncancel={handleCancel}
    />
  {/if}
</div>

<AddParserWizard
  bind:open={showAddParser}
  {accounts}
  onSuccess={(p) => {
    parsers = [...parsers, p]
  }}
/>

<style>
  .page {
    display: flex;
    flex-direction: column;
    margin: calc(-1 * var(--sp-lg));
  }

  /* ── Import setup window ── */

  .import-window {
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule);
  }

  .section-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: 4px 12px;
    background: var(--color-section-bar-bg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    color: var(--color-section-bar-fg);
    white-space: nowrap;
  }

  .import-body {
    display: flex;
    flex-direction: column;
  }

  /* ── Drop zone ── */

  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-xs);
    height: 120px;
    margin: var(--sp-md);
    background: var(--color-window-inset);
    box-shadow: var(--shadow-sunken);
    border: 2px dashed var(--color-bevel-dark);
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease),
      background var(--duration-fast) var(--ease);
  }

  .drop-zone:hover,
  .drop-zone.drag-over {
    border-color: var(--color-accent-mid);
    background: var(--color-accent-light);
  }

  .drop-zone.has-file {
    border-color: var(--color-accent);
    border-style: solid;
  }

  .drop-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    letter-spacing: 0.08em;
  }

  .drop-hint {
    font-size: var(--text-xs);
    color: var(--color-text-disabled);
  }

  .file-name {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .file-size {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .file-input-hidden {
    display: none;
  }

  /* ── Config strip ── */

  .config-strip {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-md);
    padding: var(--sp-sm) var(--sp-md);
    border-top: 1px solid var(--color-bevel-mid);
  }

  .config-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .config-account {
    flex: 1;
  }

  .config-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    color: var(--color-text-muted);
  }

  .config-submit {
    flex-shrink: 0;
  }

  /* ── Error strip ── */

  .error-strip {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-md);
    background: var(--color-danger-light);
    box-shadow: var(--shadow-sunken);
    font-size: var(--text-sm);
    border-top: 1px solid var(--color-danger);
  }

  .error-text {
    color: var(--color-danger);
  }

  .hint-text {
    color: var(--color-text-muted);
  }

  /* ── Bottom section ── */

  .bottom-cols {
    display: flex;
    flex-direction: column;
  }
</style>
