<script lang="ts">
  import { onMount } from 'svelte'
  import {
    fetchAccounts,
    fetchParsers,
    fetchGroups,
    importPreview,
    importCommit,
    checkDuplicates,
    createAccount,
    type Account,
    type CsvParser,
    type CommitTransaction,
    type ExpenseGroup,
  } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import { useSession } from '$lib/auth'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountPicker from '$lib/components/accounts/AccountPicker.svelte'
  import CurrencyInput from '$lib/components/ui/CurrencyInput.svelte'
  import TooltipIcon from '$lib/components/ui/TooltipIcon.svelte'
  import EditParserPanel from '$lib/components/import/EditParserPanel.svelte'
  import AddParserWizard from '$lib/components/wizards/AddParserWizard.svelte'
  import ImportPreviewPanel from '$lib/components/import/ImportPreviewPanel.svelte'
  import ParsersPanel from '$lib/components/import/ParsersPanel.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import type { RowState } from '$lib/components/import/ImportPreviewPanel.svelte'
  import { accountIdForCurrency, rowMissingAccounts } from '$lib/components/import/import-helpers'
  import { toast } from '$lib/toast.svelte'
  import { goto } from '$app/navigation'
  import { confetti } from '$lib/confetti.svelte'
  import { bump as refreshSidebar } from '$lib/sidebarRefresh.svelte'

  let activeTab = $state<'import' | 'export'>('import')

  // Export tab — optional date bounds (disabled until the backend export route lands).
  let exportFrom = $state('')
  let exportTo = $state('')

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
  let groups = $state<ExpenseGroup[]>([])

  const session = useSession()
  const currentUserId = $derived($session.data?.user.id ?? '')

  onMount(async () => {
    const [accts, settings, parsersData, groupsData] = await Promise.all([
      fetchAccounts(),
      settingsStore.load(),
      fetchParsers(),
      fetchGroups(),
    ])
    accounts = accts
    parsers = parsersData
    parsersLoading = false
    toAccountId = settings.defaultOffsetAccountId ?? ''
    groups = groupsData
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
    preview.transactions.forEach((tx, i) => {
      if (tx.isTransfer === true) {
        paths.add(`${rootPath}:${tx.sourceCurrency.toLowerCase()}`)
        // A cross-currency spend has no target asset — only the funding (source) account
        // is real, so don't require the user to create a target-currency sub-account.
        if (rowStates[i]?.kind !== 'spend') {
          paths.add(`${rootPath}:${tx.targetCurrency.toLowerCase()}`)
        }
      } else {
        const currency = tx.currency ?? defaultCurrency
        paths.add(`${rootPath}:${currency.toLowerCase()}`)
      }
    })
    return [...paths]
  })

  let missingPaths = $derived(
    inferredPaths.filter((path) => !accounts.some((a) => a.path === path)),
  )

  const getInferredAccountId = (currency: string): string =>
    accountIdForCurrency(accounts, rootPath, currency)

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
      const fetched = await importPreview(file, defaultCurrency)
      if (!fetched.isMultiCurrency) {
        fromAccountId = fetched.defaultAccountId ?? ''
      }
      const liabilitiesRoot =
        settingsStore.value?.defaultLiabilitiesRootPath ?? 'liabilities'
      const defaultAccountPath =
        accounts.find((a) => a.id === fetched.defaultAccountId)?.path ?? ''
      importAsLiabilities = defaultAccountPath.startsWith(`${liabilitiesRoot}:`)

      // Resolve per-row account IDs and check for duplicates. For single-currency
      // imports every row maps to defaultAccountId; for multi-currency each row
      // maps to a currency sub-account (e.g. assets:wise:usd). Transfer rows
      // pass an empty accountId and are skipped by the backend.
      //
      // Compute rootPath from `fetched` directly — we can't use the `rootPath`
      // $derived here because `preview` hasn't been assigned yet at this point.
      // Reuse defaultAccountPath computed above rather than scanning accounts twice.
      const fetchedRootPath =
        fetched.isMultiCurrency && fetched.defaultAccountId
          ? defaultAccountPath || null
          : null
      const checkRows = fetched.transactions.map((tx) => ({
        accountId:
          tx.isTransfer === false
            ? fetched.isMultiCurrency
              ? accountIdForCurrency(accounts, fetchedRootPath, tx.currency ?? defaultCurrency)
              : (fetched.defaultAccountId ?? '')
            : '',
        date: tx.date,
        amount: tx.isTransfer === false ? tx.amount : '0',
      }))
      const perRowDuplicates = await checkDuplicates(checkRows)

      // Populate rowStates BEFORE assigning preview — the template renders
      // ImportPreviewPanel as soon as preview is truthy, so rowStates must
      // already have one entry per transaction to avoid undefined[i] errors.
      rowStates = fetched.transactions.map((tx, i) => ({
        offsetAccountId:
          tx.isTransfer === false && tx.suggestedOffsetAccountId
            ? tx.suggestedOffsetAccountId
            : toAccountId,
        conversionAccountId:
          settingsStore.value?.defaultConversionAccountId ?? '',
        feeAccountId: fetched.defaultFeeAccountId ?? '',
        skipped: perRowDuplicates[i] != null,
        possibleDuplicate: perRowDuplicates[i] ?? null,
        groupId: null,
        categoryId: null,
        // Cross-currency rows default to spend unless the preview flagged a convert-and-park.
        kind: tx.isTransfer === true ? (tx.suggestedKind ?? 'spend') : 'spend',
        // Spend rows pre-fill the expense account from the import rule, else fall back to the
        // uncategorized account so the spend is still importable and surfaces for review.
        expenseAccountId:
          tx.isTransfer === true && tx.suggestedKind !== 'transfer'
            ? (tx.suggestedExpenseAccountId ?? toAccountId)
            : '',
      }))
      preview = fetched
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
    const invalid = preview.transactions.some(
      (tx, i) => !rowStates[i].skipped && rowMissingAccounts(tx, rowStates[i]),
    )
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
          if (row.kind === 'spend' && !row.groupId) {
            // Cross-currency spend — no target asset; the spend lands in the expense
            // account, bridged through equity:conversions on both sides (story-1 shape).
            // A *shared* spend (groupId set) falls through to the transfer-shaped row below,
            // which the backend routes to the Fish Pie cross-currency path — that splits the
            // target leg into group + payer-expense (no phantom asset either).
            return {
              isTransfer: 'cross-currency-spend' as const,
              date: tx.date,
              description: tx.description,
              sourceAmount: tx.sourceAmount,
              sourceCurrency: tx.sourceCurrency,
              targetAmount: tx.targetAmount,
              targetCurrency: tx.targetCurrency,
              feeAmount: tx.feeAmount,
              feeCurrency: tx.feeCurrency,
              sourceAccountId: getInferredAccountId(tx.sourceCurrency),
              expenseAccountId: row.expenseAccountId,
              conversionAccountId: row.conversionAccountId,
              feeAccountId: row.feeAccountId,
            }
          }
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
      // Build groupSplits re-indexed to txs positions (skipped rows excluded from txs)
      const groupSplits: { rowIndex: number; groupId: string; categoryId: string | null }[] = []
      let txIdx = 0
      for (let i = 0; i < rowStates.length; i++) {
        if (rowStates[i].skipped) continue
        if (rowStates[i].groupId) {
          groupSplits.push({
            rowIndex: txIdx,
            groupId: rowStates[i].groupId!,
            categoryId: rowStates[i].categoryId,
          })
        }
        txIdx++
      }

      const result = await importCommit({
        accountId: fromAccountId,
        defaultCurrency,
        transactions: txs,
        groupSplits: groupSplits.length > 0 ? groupSplits : undefined,
      })
      const fishPieMsg =
        result.fishPieExpenses > 0
          ? `, ${result.fishPieExpenses} added to Fish Pie`
          : ''
      toast.show(`${result.created} transaction(s) imported${fishPieMsg}`)
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

  function clearFile() {
    file = null
    error = ''
    noParserFound = false
  }

  // Once a preview is loaded the user is partway through categorizing rows, and all
  // that work lives only in this page's in-memory state. Warn before a refresh / tab
  // close so an accidental unload can't silently wipe the session. A successful import
  // leaves via client-side `goto`, which never triggers beforeunload, so this only
  // fires on a real browser unload during the preview stage.
  $effect(() => {
    if (!preview) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  })
</script>

<div class="page">
  {#if !preview}
    <div class="transfer-window">
      <div class="section-bar">
        <div class="tabs">
          <button
            type="button"
            class="tab"
            class:active={activeTab === 'import'}
            aria-pressed={activeTab === 'import'}
            onclick={() => (activeTab = 'import')}
          >
            <Icon name="import" size={13} />
            Import
          </button>
          <button
            type="button"
            class="tab"
            class:active={activeTab === 'export'}
            aria-pressed={activeTab === 'export'}
            onclick={() => (activeTab = 'export')}
          >
            <Icon name="export" size={13} />
            Export
          </button>
          <a class="tab tab-link" href="/import/rules">
            <Icon name="settings" size={13} />
            Rules
          </a>
        </div>
      </div>

      {#if activeTab === 'import'}
        <form
          class="import-body"
          onsubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <!-- The whole strip is still a drop target, but clicking the button is the
               primary path — most people use the file picker, so it leads. -->
          <div
            class="file-row"
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
            role="presentation"
          >
            {#if file}
              <span class="file-chip">
                <Icon name="import" size={13} />
                <span class="file-name">{file.name}</span>
                <span class="file-size">{(file.size / 1024).toFixed(1)} KB</span>
                <button
                  type="button"
                  class="file-clear"
                  aria-label="Remove file"
                  onclick={clearFile}>✕</button
                >
              </span>
              <GradientButton type="submit" size="lg" disabled={loading} active>
                {loading ? 'Parsing…' : 'Preview import'}
              </GradientButton>
            {:else}
              <label class="choose-btn">
                <Icon name="import" size={14} />
                Choose CSV…
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
              <span class="drop-hint">
                or drop a file here
                <span class="pacman"
                  ><Icon name="pacman" size={14} /><Icon name="dot" size={6} /><Icon
                    name="dot"
                    size={6}
                  /><Icon name="cherry" size={12} /></span
                >
              </span>
            {/if}
          </div>

          <details class="defaults">
            <summary class="defaults-summary">
              <Icon name="arrow-right" size={10} />
              <span class="defaults-label">Defaults</span>
              <span class="defaults-values">
                {defaultCurrency} ·
                {accounts.find((a) => a.id === toAccountId)?.path ?? 'no uncategorized account'}
              </span>
            </summary>
            <div class="import-fields">
              <div class="import-field">
                <label class="import-label" for="default-currency">
                  Default currency
                  <TooltipIcon
                    label="The currency to use when the CSV doesn't specify one."
                  />
                </label>
                <CurrencyInput
                  id="default-currency"
                  bind:value={defaultCurrency}
                  style="width: 5rem"
                />
              </div>
              <div class="import-field import-account">
                <span class="import-label">
                  Uncategorized account
                  <TooltipIcon
                    label="Transactions with no matching import rule are posted to this account."
                  />
                </span>
                <AccountPicker
                  {accounts}
                  bind:value={toAccountId}
                  placeholder="Select or create an account…"
                  oncreate={handleAccountCreated}
                />
              </div>
            </div>
          </details>

          {#if error}
            <div class="error-strip">
              <span class="error-text">{error}</span>
              {#if noParserFound}
                <span class="hint-text">
                  Go to <a href="/settings">Settings</a> to add a parser for this file.
                </span>
              {/if}
            </div>
          {/if}
        </form>
      {:else}
        <div class="export-body">
          <p class="export-blurb">
            Download all your data as an hledger-compatible <code>.journal</code> file.
            This is your escape hatch — nothing is locked in.
          </p>

          <div class="import-fields">
            <div class="import-field">
              <label class="import-label" for="export-from">
                From
                <TooltipIcon label="Leave both dates empty to export everything." />
              </label>
              <input
                id="export-from"
                type="date"
                class="date-input"
                bind:value={exportFrom}
                disabled
              />
            </div>
            <div class="import-field">
              <label class="import-label" for="export-to">To</label>
              <input id="export-to" type="date" class="date-input" bind:value={exportTo} disabled />
            </div>
          </div>

          <div class="actions-bar">
            <GradientButton size="lg" disabled tooltip="Coming soon">
              <Icon name="export" size={14} />
              Export journal
            </GradientButton>
          </div>
        </div>
      {/if}
    </div>

    {#if activeTab === 'import'}
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
    {/if}
  {:else}
    <ImportPreviewPanel
      {preview}
      bind:rowStates
      {accounts}
      {groups}
      {currentUserId}
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
  }

  /* ── Transfer window (Import / Export tabs) ── */

  .transfer-window {
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule);
  }

  .section-bar {
    display: flex;
    align-items: stretch;
    padding: 0 var(--sp-sm);
    background: var(--color-section-bar-bg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
  }

  /* ── Tabs ── */

  .tabs {
    display: flex;
    gap: 2px;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 14px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
      color var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }

  .tab:hover {
    color: var(--color-text);
  }

  .tab.active {
    color: var(--color-accent);
    border-bottom-color: var(--color-accent);
  }

  .tab:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  /* Rules is a navigation tab (leaves the page), styled like the toggle tabs. */
  .tab-link {
    text-decoration: none;
  }

  .import-body,
  .export-body {
    display: flex;
    flex-direction: column;
  }

  /* ── File row (click-first, drop-secondary) ── */

  .file-row {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: var(--sp-md);
    border-radius: var(--radius-lg);
    margin: var(--sp-md);
    background: var(--color-window-inset);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);
    border: 1px dashed var(--color-border);
    transition:
      border-color var(--duration-fast) var(--ease),
      background var(--duration-fast) var(--ease);
  }

  .file-row.drag-over {
    border-color: var(--color-accent-mid);
    border-style: solid;
    background: var(--color-accent-light);
  }

  .choose-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 16px;
    background: linear-gradient(180deg, var(--color-btn-gradient-hi), var(--color-rule-soft));
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }

  .choose-btn:hover {
    background: linear-gradient(180deg, var(--color-btn-gradient-hi), var(--color-accent-chip-bg));
    border-color: var(--color-accent);
  }

  .choose-btn:focus-within {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 1px;
  }

  .drop-hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--color-text-disabled);
  }

  .pacman {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--color-text-disabled);
  }

  .file-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px 5px 10px;
    background: var(--color-accent-chip-bg);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-pill);
    color: var(--color-text);
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

  .file-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-pill);
    font-size: 11px;
    line-height: 1;
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }

  .file-clear:hover {
    background: var(--color-danger-light);
    color: var(--color-danger);
  }

  .file-input-hidden {
    display: none;
  }

  /* ── Defaults disclosure (rarely touched once set up) ── */

  .defaults {
    border-top: 1px solid var(--color-rule);
  }

  .defaults-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: var(--sp-sm) var(--sp-md);
    cursor: pointer;
    list-style: none;
    user-select: none;
  }

  .defaults-summary::-webkit-details-marker {
    display: none;
  }

  /* Disclosure caret — points right when closed, rotates down when open. */
  .defaults-summary :global(.icon) {
    color: var(--color-text-muted);
    transition: transform var(--duration-fast) var(--ease);
  }

  .defaults[open] .defaults-summary :global(.icon) {
    transform: rotate(90deg);
  }

  .defaults-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .defaults-values {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-disabled);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .defaults[open] .defaults-values {
    display: none;
  }

  /* ── Config fields ── */

  .import-fields {
    display: flex;
    align-items: center;
    gap: var(--sp-lg);
    padding: var(--sp-sm) var(--sp-md);
    border-top: 1px solid var(--color-rule);
  }

  .import-field {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .import-account {
    flex: 1;
  }

  /* Size the picker to its content (path/placeholder) instead of filling the row. */
  .import-account :global(.picker) {
    width: fit-content;
    max-width: 100%;
  }

  .import-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .date-input {
    height: 28px;
    padding: 0 8px;
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-inset);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .date-input:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  /* ── Actions bar ── */

  .actions-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-md);
    border-top: 1px solid var(--color-rule);
    background: linear-gradient(
      180deg,
      var(--color-window),
      var(--color-window-raised)
    );
  }

  /* ── Export blurb ── */

  .export-blurb {
    margin: 0;
    padding: var(--sp-md) var(--sp-md) 0;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--color-text-muted);
    max-width: 52ch;
  }

  .export-blurb code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 1px 4px;
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text);
  }

  /* ── Error strip ── */

  .error-strip {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-md);
    background: var(--color-danger-light);
    font-size: var(--text-xs);
    font-family: var(--font-sans);
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
