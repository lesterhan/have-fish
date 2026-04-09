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
  import Button from '$lib/components/ui/Button.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import Panel from '$lib/components/ui/Panel.svelte'
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

{#if !preview}
  <Panel title="Import CSV">
    <form
      class="import-form"
      onsubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
    >
      <div class="form-grid">
        <label class="field-label" for="to-account">Uncategorized account</label
        >
        <AccountPathInput
          {accounts}
          bind:value={toAccountId}
          placeholder="Select or create an account…"
          oncreate={handleAccountCreated}
        />

        <label class="field-label" for="default-currency"
          >Default currency</label
        >
        <TextInput
          id="default-currency"
          bind:value={defaultCurrency}
          placeholder="CAD"
          style="width: 5rem"
          required
        />

        <label class="field-label" for="csv-file">CSV file</label>
        <input
          id="csv-file"
          type="file"
          accept=".csv"
          onchange={(e) => {
            file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null
          }}
          required
        />
      </div>

      {#if error}
        <p class="error">{error}</p>
        {#if noParserFound}
          <p class="hint">
            Go to <a href="/settings">Settings</a> to create a parser for this file.
          </p>
        {/if}
      {/if}

      <div class="form-actions">
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? 'Parsing…' : 'Preview import'}
        </Button>
      </div>
    </form>
  </Panel>

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

<AddParserWizard
  bind:open={showAddParser}
  {accounts}
  onSuccess={(p) => {
    parsers = [...parsers, p]
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

<style>
  .import-form {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    padding: var(--sp-sm);
  }

  .form-grid {
    display: grid;
    grid-template-columns: max-content auto;
    align-items: center;
    gap: var(--sp-xs) var(--sp-sm);
    font-size: var(--text-sm);
  }

  .field-label {
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }

  .form-actions {
    display: flex;
    justify-content: flex-start;
    padding-top: var(--sp-xs);
    border-top: 1px solid var(--color-bevel-mid);
  }

  .error {
    font-size: var(--text-sm);
    color: var(--color-danger);
  }

  .hint {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin-top: var(--sp-xs);
  }
</style>
