<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import {
    fetchAccounts,
    fetchParsers,
    fetchGroups,
    importPreview,
    importCommit,
    checkDuplicates,
    createRule,
    type Account,
    type CsvParser,
    type CommitTransaction,
    type ExpenseGroup,
    createCoverage,
  } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import { isUnderRoot } from '$lib/components/accounts/accountPaths'
  import { useSession } from '$lib/auth'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountPicker from '$lib/components/accounts/AccountPicker.svelte'
  import CurrencyInput from '$lib/components/ui/CurrencyInput.svelte'
  import TooltipIcon from '$lib/components/ui/TooltipIcon.svelte'
  import Toggle from '$lib/components/ui/Toggle.svelte'
  import Modal from '$lib/components/ui/Modal.svelte'
  import EditParserPanel from '$lib/components/import/EditParserPanel.svelte'
  import AddParserWizard from '$lib/components/wizards/AddParserWizard.svelte'
  import ImportPreviewPanel from '$lib/components/import/ImportPreviewPanel.svelte'
  import ParsersPanel from '$lib/components/import/ParsersPanel.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import type { RowState } from '$lib/components/import/row-state'
  import ImportStepper from '$lib/components/import/ImportStepper.svelte'
  import ImportAccountsStep from '$lib/components/import/ImportAccountsStep.svelte'
  import ImportSortStep from '$lib/components/import/ImportSortStep.svelte'
  import ImportConfirmStep from '$lib/components/import/ImportConfirmStep.svelte'
  import { buildManifest } from '$lib/components/import/manifest'
  import {
    hashCsv,
    saveSession,
    clearSession,
    latestSession,
    describeAge,
    SESSION_VERSION,
    type ImportSession,
    type ImportStep,
    parseCatchUpHandoff,
    defaultCoverageRange,
    type CatchUpHandoff,
    type DateRange,
  } from '$lib/import-session'
  import {
    currenciesInPreview,
    seedCurrencyAccounts,
    rowMissingAccounts,
  } from '$lib/components/import/import-helpers'
  import { rowsMatchingPattern } from '$lib/components/import/review-status'
  import {
    buildClusters,
    initialClusterState,
    clusterTarget,
    membersToWrite,
    applyTarget,
    type ClusterState,
    type RowTarget,
  } from '$lib/components/import/clustering'
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

  // null = follow the account path; a boolean is the user's explicit override.
  let liabilitiesOverride = $state<boolean | null>(null)

  let editingParser = $state<CsvParser | null>(null)
  let showAddParser = $state(false)

  let rowStates = $state<RowState[]>([])
  let groups = $state<ExpenseGroup[]>([])

  // --- Session ---

  let step = $state<ImportStep>('file')
  let fileHash = $state('')
  let fileName = $state('')
  // Currency code → account id, for multi-currency imports. Single-currency imports post
  // every row to one account, which stays in fromAccountId.
  let currencyAccounts = $state<Record<string, string>>({})
  let clusterStates = $state<ClusterState[]>([])
  let applyingClusters = $state(false)
  // Rules and accounts this import has already written, for the Confirm manifest. Both are
  // created as the user goes rather than deferred to commit, so they are recorded here.
  let rulesCreated = $state<string[]>([])
  let accountsCreated = $state<string[]>([])
  // A saved import found on mount, offered for resume until accepted or dismissed.
  let resumable = $state<ImportSession | null>(null)

  // --- Catch-Up Coach handoff ---
  //
  // Set when the coach sent the user here for a specific account and date range. Drives the
  // "this file covers" default, the return path, and the mismatch notice.
  let catchUp = $state<CatchUpHandoff | null>(null)
  let returnToCatchUp = $state(false)
  // What the user says this file covers. Null until Confirm seeds it.
  let coverageRange = $state<DateRange | null>(null)

  // Only the steps that exist today. Later stories in this epic insert Sort and Confirm;
  // until then the stepper must not advertise them.
  const STEPS: { id: ImportStep; label: string }[] = [
    { id: 'file', label: 'File' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'sort', label: 'Sort' },
    { id: 'review', label: 'Review' },
    { id: 'confirm', label: 'Confirm' },
  ]

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
    resumable = latestSession()

    // Read once on mount rather than reactively: the handoff describes how this import
    // started, and a later navigation that drops the query string must not un-start it.
    catchUp = parseCatchUpHandoff(page.url.searchParams)
    returnToCatchUp = page.url.searchParams.get('return') === 'catch-up'
  })

  // --- Import as liabilities ---
  //
  // Derived from the parser's default account rather than toggled. The CSV of a credit
  // card states a charge as a positive number; posting it to a liability account means
  // storing it negated. That follows from the account, so it is shown as a fact with an
  // override available, not as a switch — flipping it mid-review silently re-signs every
  // amount in the table.
  let derivedLiabilities = $derived.by(() => {
    if (!preview) return false
    const root = settingsStore.value?.defaultLiabilitiesRootPath ?? 'liabilities'
    const path = accounts.find((a) => a.id === preview!.defaultAccountId)?.path ?? ''
    return isUnderRoot(path, root)
  })
  let importAsLiabilities = $derived(liabilitiesOverride ?? derivedLiabilities)

  // The span the CSV covers, for the File step's summary.
  let dateRange = $derived.by(() => {
    const dates = (preview?.transactions ?? []).map((tx) => tx.date).filter(Boolean).sort()
    if (dates.length === 0) return ''
    const first = dates[0].slice(0, 10)
    const last = dates[dates.length - 1].slice(0, 10)
    return first === last ? first : `${first} → ${last}`
  })

  // The source accounts this import actually posts to — where coverage lands. A multi-currency
  // export covers every sub-account it feeds, not just the parser's default.
  let coverageAccountIds = $derived.by(() => {
    if (preview?.isMultiCurrency) {
      return [...new Set(Object.values(currencyAccounts).filter(Boolean))]
    }
    return fromAccountId ? [fromAccountId] : []
  })

  // Whether the file landed on the account the coach asked about. A mismatch is worth saying
  // out loud rather than silently overriding the parser: posting a chequing CSV into a credit
  // card because the coach happened to ask about the card would be far worse than a notice.
  let handoffMismatch = $derived(
    catchUp !== null &&
      coverageAccountIds.length > 0 &&
      !coverageAccountIds.includes(catchUp.accountId),
  )

  let handoffAccountPath = $derived(
    catchUp ? (accounts.find((a) => a.id === catchUp!.accountId)?.path ?? 'that account') : '',
  )

  // Seeded when Confirm is first reached, then left alone so an edit survives walking back
  // to Review and forward again.
  $effect(() => {
    if (step !== 'confirm' || coverageRange !== null) return
    coverageRange = defaultCoverageRange(catchUp, manifest?.dateRange ?? null)
  })

  // --- Session persistence ---

  function currentSession(): ImportSession | null {
    if (!preview || !fileHash) return null
    return {
      version: SESSION_VERSION,
      fileHash,
      fileName,
      step,
      defaultCurrency,
      fromAccountId,
      currencyAccounts: $state.snapshot(currencyAccounts),
      clusterStates: $state.snapshot(clusterStates) as ClusterState[],
      rulesCreated: $state.snapshot(rulesCreated) as string[],
      accountsCreated: $state.snapshot(accountsCreated) as string[],
      importAsLiabilities: liabilitiesOverride,
      catchUp: $state.snapshot(catchUp) as CatchUpHandoff | null,
      coverageRange: $state.snapshot(coverageRange) as DateRange | null,
      preview: $state.snapshot(preview) as typeof preview,
      rowStates: $state.snapshot(rowStates) as RowState[],
      savedAt: new Date().toISOString(),
    }
  }

  // Persist on every change to the decisions worth keeping. Debounced because editing an
  // account picker fires this per keystroke and a 200-row preview is not a small write.
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  $effect(() => {
    const snapshot = currentSession()
    if (!snapshot) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveSession(snapshot), 400)
    return () => {
      if (saveTimer) clearTimeout(saveTimer)
    }
  })

  function resumeSession(saved: ImportSession) {
    preview = saved.preview
    rowStates = saved.rowStates
    fileHash = saved.fileHash
    fileName = saved.fileName
    defaultCurrency = saved.defaultCurrency
    fromAccountId = saved.fromAccountId
    currencyAccounts = saved.currencyAccounts
    clusterStates = saved.clusterStates
    rulesCreated = saved.rulesCreated
    accountsCreated = saved.accountsCreated
    liabilitiesOverride = saved.importAsLiabilities
    catchUp = saved.catchUp
    returnToCatchUp = saved.catchUp !== null
    coverageRange = saved.coverageRange
    step = saved.step
    resumable = null
  }

  function discardResumable() {
    if (resumable) clearSession(resumable.fileHash)
    resumable = null
  }

  // --- Currency → account mapping ---
  //
  // The mapping is state the user owns, not a path convention re-derived at each use.
  // `rootPath` and the seeding helpers only produce the *suggestion*; once the Accounts
  // step has run, nothing downstream may rebuild an account from a currency code.

  let rootPath = $derived.by(() => {
    if (!preview?.isMultiCurrency || !preview.defaultAccountId) return null
    return (
      accounts.find((a) => a.id === preview!.defaultAccountId)?.path ?? null
    )
  })

  let importCurrencies = $derived(
    preview?.isMultiCurrency
      ? currenciesInPreview(preview.transactions, defaultCurrency)
      : [],
  )

  // The account this import posts a given currency to. Empty string when unmapped, which
  // the Accounts step gates on and Confirm re-checks for rows flipped after the fact.
  const accountForCurrency = (currency: string): string =>
    currencyAccounts[currency.toUpperCase()] ?? ''

  // Currencies the rows actually need right now, unlike importCurrencies which is fixed at
  // parse time. Flipping a spend to convert-and-park introduces a target currency the
  // Accounts step never asked about, so commit re-checks against live row state.
  let unmappedCommitCurrencies = $derived.by(() => {
    if (!preview?.isMultiCurrency) return []
    const needed = new Set<string>()
    preview.transactions.forEach((tx, i) => {
      if (rowStates[i]?.skipped) return
      if (tx.isTransfer === true) {
        needed.add(tx.sourceCurrency.toUpperCase())
        if (rowStates[i]?.kind !== 'spend') needed.add(tx.targetCurrency.toUpperCase())
      } else if (tx.isTransfer === 'same-currency') {
        needed.add(tx.currency.toUpperCase())
      } else {
        needed.add((tx.currency ?? defaultCurrency).toUpperCase())
      }
    })
    return [...needed].filter((c) => !currencyAccounts[c])
  })

  // --- Account creation helpers ---

  function handleAccountCreated(account: Account) {
    accounts = [...accounts, account]
    if (!accountsCreated.includes(account.path)) accountsCreated = [...accountsCreated, account.path]
  }

  // --- Preview ---

  // Whether the Accounts step has anything to ask. Reads currencyAccounts, which
  // handleSubmit has already seeded by the time this is called.
  function accountsStepNeeded(fetched: NonNullable<typeof preview>): boolean {
    if (!fetched.isMultiCurrency) return !fromAccountId
    return currenciesInPreview(fetched.transactions, defaultCurrency).some(
      (c) => !currencyAccounts[c],
    )
  }

  // Leaving the File step, forward. Used both on first parse and when the user walks back
  // to File and continues, so steps are skipped by the same rule either way.
  function advanceFromFile() {
    if (!preview) return
    if (accountsStepNeeded(preview)) {
      step = 'accounts'
      return
    }
    advanceFromAccounts()
  }

  // Walking back to Sort through the stepper must find its form populated, not empty.
  function navigateToStep(next: ImportStep) {
    if (next === 'sort' && clusterStates.length === 0) seedClusterStates()
    step = next
  }

  function advanceFromAccounts() {
    if (sortStepNeeded()) {
      seedClusterStates()
      step = 'sort'
      return
    }
    step = 'review'
  }

  async function handleSubmit() {
    if (!file || !defaultCurrency) {
      error = 'File and default currency are required.'
      return
    }
    error = ''
    noParserFound = false
    loading = true
    try {
      const csvText = await file.text()
      const fetched = await importPreview(file, defaultCurrency)
      if (!fetched.isMultiCurrency) {
        fromAccountId = fetched.defaultAccountId ?? ''
      }
      const defaultAccountPath =
        accounts.find((a) => a.id === fetched.defaultAccountId)?.path ?? ''
      // A fresh parse starts from the derived value; the override is the user's, per file.
      liabilitiesOverride = null

      // Seed the currency → account map from the path convention. Currencies with no
      // matching account are left empty for the Accounts step to resolve.
      //
      // Compute rootPath from `fetched` directly — we can't use the `rootPath` $derived
      // here because `preview` hasn't been assigned yet at this point. Reuse
      // defaultAccountPath computed above rather than scanning accounts twice.
      const fetchedRootPath =
        fetched.isMultiCurrency && fetched.defaultAccountId
          ? defaultAccountPath || null
          : null
      currencyAccounts = fetched.isMultiCurrency
        ? seedCurrencyAccounts(
            currenciesInPreview(fetched.transactions, defaultCurrency),
            accounts,
            fetchedRootPath,
          )
        : {}

      // Check for duplicates against the account each row will actually post to — the
      // same map commit reads, so the pre-check and the commit can't disagree. Transfer
      // rows pass an empty accountId and are skipped by the backend.
      const checkRows = fetched.transactions.map((tx) => ({
        accountId:
          tx.isTransfer === false
            ? fetched.isMultiCurrency
              ? (currencyAccounts[(tx.currency ?? defaultCurrency).toUpperCase()] ?? '')
              : (fetched.defaultAccountId ?? '')
            : '',
        date: tx.date,
        amount: tx.isTransfer === false ? tx.amount : '0',
      }))
      const perRowDuplicates = await checkDuplicates(checkRows)

      // Populate rowStates BEFORE assigning preview — the template renders
      // ImportPreviewPanel as soon as preview is truthy, so rowStates must
      // already have one entry per transaction to avoid undefined[i] errors.
      rowStates = fetched.transactions.map((tx, i) => {
        // A matching split rule pre-splits the row instead of pre-filling an account.
        // A convert-and-park is excluded: it moves money between the user's own accounts,
        // so there is no expense to share.
        const isSplitSuggestion =
          !!tx.suggestedGroupId && !(tx.isTransfer === true && tx.suggestedKind === 'transfer')

        return {
          offsetAccountId:
            tx.isTransfer === false && tx.suggestedOffsetAccountId
              ? tx.suggestedOffsetAccountId
              : toAccountId,
          conversionAccountId:
            settingsStore.value?.defaultConversionAccountId ?? '',
          feeAccountId: fetched.defaultFeeAccountId ?? '',
          skipped: perRowDuplicates[i] != null,
          possibleDuplicate: perRowDuplicates[i] ?? null,
          groupId: isSplitSuggestion ? (tx.suggestedGroupId ?? null) : null,
          categoryId: isSplitSuggestion ? (tx.suggestedCategoryId ?? null) : null,
          // Cross-currency rows default to spend unless the preview flagged a convert-and-park.
          kind: tx.isTransfer === true ? (tx.suggestedKind ?? 'spend') : 'spend',
          // Spend rows pre-fill the expense account from the import rule, else fall back to the
          // uncategorized account so the spend is still importable and surfaces for review.
          // A split row leaves it empty — its expense leg derives from the category at commit.
          expenseAccountId:
            tx.isTransfer === true && tx.suggestedKind !== 'transfer' && !isSplitSuggestion
              ? (tx.suggestedExpenseAccountId ?? toAccountId)
              : '',
          // A rule filled this row in; anything else is still sitting at its default.
          source: tx.matchedRulePattern ? ('rule' as const) : ('none' as const),
        }
      })
      preview = fetched
      fileHash = await hashCsv(csvText)
      fileName = file.name
      // Re-parsing a file already in progress replaces its saved session rather than
      // leaving a second copy behind.
      resumable = null
      clusterStates = []
      rulesCreated = []
      accountsCreated = []
      // Both middle steps are skipped when they have nothing to ask: Accounts when every
      // currency already resolved on seed, Sort when no merchant repeats.
      if (accountsStepNeeded(fetched)) {
        step = 'accounts'
      } else if (buildClusters(fetched.transactions, defaultCurrency).length > 0) {
        clusterStates = buildClusters(fetched.transactions, defaultCurrency).map(initialClusterState)
        step = 'sort'
      } else {
        step = 'review'
      }
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

  // --- Sort ---

  // Clusters come from the preview's merchant stems, so the set is fixed once the file is
  // parsed. Row edits change what a cluster would *write*, never which clusters exist.
  let clusters = $derived(
    preview ? buildClusters(preview.transactions, defaultCurrency) : [],
  )

  // Nothing to sort when no merchant repeats — the step is skipped rather than shown empty.
  function sortStepNeeded(): boolean {
    return clusters.length > 0
  }

  // Seed one state per cluster, keeping any decisions already made for a stem that survived
  // a re-parse.
  function seedClusterStates() {
    const previous = new Map(clusterStates.map((c) => [c.key, c]))
    clusterStates = clusters.map((c) => previous.get(c.key) ?? initialClusterState(c))
  }

  async function handleApplyClusters(override: boolean) {
    if (!preview) return
    applyingClusters = true
    try {
      let written = 0
      let created = 0

      for (const cluster of clusters) {
        const state = clusterStates.find((c) => c.key === cluster.key)
        if (!state) continue
        const target = clusterTarget(state)
        if (!target) continue

        for (const i of membersToWrite(cluster, state, rowStates, override)) {
          rowStates[i] = applyTarget(preview.transactions[i], rowStates[i], target, 'cluster')
          written++
        }

        // Remember writes an active rule from the stem and target, so the next import of
        // this file's merchants needs no Sort pass at all.
        if (state.remember) {
          try {
            await createRule({
              pattern: cluster.key,
              ...(target.kind === 'split'
                ? { groupId: target.groupId, categoryId: target.categoryId }
                : { accountId: target.accountId }),
            })
            created++
            if (!rulesCreated.includes(cluster.key)) rulesCreated = [...rulesCreated, cluster.key]
          } catch (e) {
            toast.show(
              `Applied ${cluster.key}, but the rule could not be saved: ${e instanceof Error ? e.message : 'unknown error'}`,
            )
          }
        }
      }

      const ruleMsg = created > 0 ? `, ${created} rule${created === 1 ? '' : 's'} saved` : ''
      toast.show(`${written} row${written === 1 ? '' : 's'} assigned${ruleMsg}`)
      step = 'review'
    } finally {
      applyingClusters = false
    }
  }

  // --- Review edits ---

  // Any direct edit makes the row the user's, which is what moves it out of the
  // Needs-review filter and marks it Done. A cluster assign in the Sort step deliberately
  // will not overwrite these.
  function handleRowEdited(index: number) {
    const row = rowStates[index]
    if (!row || row.source === 'user') return
    rowStates[index] = { ...row, source: 'user' }
  }

  // Turns one decided row into a saved rule, then applies it to the rows it would have
  // pre-filled. Only rows still sitting at their default are back-filled — a row the user
  // decided on, or one another rule already claimed, is not up for grabs.
  async function handleSaveRule(index: number) {
    const tx = preview?.transactions[index]
    const row = rowStates[index]
    if (!tx?.merchantKey || !row) return

    const target = row.groupId
      ? { groupId: row.groupId, categoryId: row.categoryId }
      : { accountId: tx.isTransfer === true ? row.expenseAccountId : row.offsetAccountId }
    if (!row.groupId && !target.accountId) return

    try {
      await createRule({ pattern: tx.merchantKey, ...target })
      if (!rulesCreated.includes(tx.merchantKey)) rulesCreated = [...rulesCreated, tx.merchantKey]
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Could not save the rule.')
      return
    }

    const rowTarget: RowTarget = row.groupId
      ? { kind: 'split', groupId: row.groupId, categoryId: row.categoryId }
      : { kind: 'account', accountId: target.accountId! }
    const matches = rowsMatchingPattern(preview!.transactions, rowStates, tx.merchantKey)
    for (const i of matches) {
      rowStates[i] = applyTarget(preview!.transactions[i], rowStates[i], rowTarget, 'cluster')
    }

    const applied = matches.length
    toast.show(
      applied > 0
        ? `Rule saved for “${tx.merchantKey}” — applied to ${applied} more row${applied === 1 ? '' : 's'}`
        : `Rule saved for “${tx.merchantKey}”`,
    )
  }

  // --- Confirm ---

  let manifest = $derived(
    preview
      ? buildManifest(preview.transactions, rowStates, preview.errors.length, {
          accounts,
          groups,
          currencyAccounts,
          fromAccountId,
          isMultiCurrency: preview.isMultiCurrency,
          defaultCurrency,
          uncategorizedAccountId: toAccountId,
          rulesCreated,
          accountsCreated,
        })
      : null,
  )

  // Jump from the Confirm manifest back to a specific row in Review.
  function jumpToRow(index: number) {
    step = 'review'
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-row-index="${index}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.querySelector<HTMLElement>('button, input')?.focus()
    })
  }

  // --- Commit ---

  async function handleConfirm() {
    if (!preview) return
    if (!preview.isMultiCurrency && !fromAccountId) {
      error = 'From account is required.'
      return
    }
    // The Accounts step covers every currency the preview expected. This catches the tail:
    // a row flipped to convert-and-park after that step introduces a target currency the
    // step never asked about. Name the currencies rather than saying "some account".
    if (unmappedCommitCurrencies.length > 0) {
      error = `No account mapped for ${unmappedCommitCurrencies.join(', ')}. Go back to Accounts to map ${unmappedCommitCurrencies.length === 1 ? 'it' : 'them'}.`
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
              sourceAccountId: accountForCurrency(tx.sourceCurrency),
              expenseAccountId: row.expenseAccountId,
              conversionAccountId: row.conversionAccountId,
              feeAccountId: row.feeAccountId,
            }
          }
          return {
            ...tx,
            sourceAccountId: accountForCurrency(tx.sourceCurrency),
            targetAccountId: accountForCurrency(tx.targetCurrency),
            conversionAccountId: row.conversionAccountId,
            feeAccountId: row.feeAccountId,
          }
        } else if (tx.isTransfer === 'same-currency') {
          return {
            ...tx,
            targetAccountId: preview!.isMultiCurrency
              ? accountForCurrency(tx.currency)
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
                  sourceAccountId: accountForCurrency(
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

      // Record what this file covered. The ledger write already succeeded, so a failure here
      // must not read as a failed import — the transactions are in, and the worst case is the
      // coach asking about a range that is now actually complete.
      const covered = coverageRange
      if (covered) {
        await Promise.all(
          coverageAccountIds.map((accountId) =>
            createCoverage({
              accountId,
              fromDate: covered.from,
              throughDate: covered.to,
              source: 'import',
              note: fileName || undefined,
            }),
          ),
        ).catch(() => {
          toast.show('Imported, but the covered range could not be recorded')
        })
      }

      // Land on what was just imported. Uses the committed range, not the CSV's — a leading
      // week of skipped duplicates would otherwise open on rows the user did not import.
      const range = manifest?.dateRange
      // Read before resetSession clears the state these came from.
      const backToCoach = returnToCatchUp
      resetSession()
      if (backToCoach) {
        goto('/catch-up')
      } else {
        goto(range ? `/transactions?from=${range.from}&to=${range.to}` : '/transactions')
      }
    } catch {
      error = 'Import failed. Please try again.'
    } finally {
      loading = false
    }
  }

  // Drops the in-progress import, in memory and in storage. Callers are responsible for
  // confirming first where the work would be lost rather than committed.
  function resetSession() {
    if (fileHash) clearSession(fileHash)
    if (saveTimer) clearTimeout(saveTimer)
    preview = null
    fromAccountId = ''
    rowStates = []
    liabilitiesOverride = null
    fileHash = ''
    fileName = ''
    file = null
    currencyAccounts = {}
    clusterStates = []
    rulesCreated = []
    accountsCreated = []
    catchUp = null
    coverageRange = null
    step = 'file'
  }

  // Discarding throws away every row decision made so far and there is no undo, so it
  // asks first — this used to wipe the session on a single unguarded click.
  let showDiscardConfirm = $state(false)

  function handleCancel() {
    showDiscardConfirm = true
  }

  function confirmDiscard() {
    showDiscardConfirm = false
    resetSession()
    error = ''
  }

  function clearFile() {
    file = null
    error = ''
    noParserFound = false
  }
</script>

<div class="page">
  <!-- Rendered above both branches: the point of this strip is to say why the user is here
       *before* they pick a file, not once one is already parsed. -->
  {#if catchUp}
    <div class="coach-strip" class:mismatch={handoffMismatch}>
      <Icon name={handoffMismatch ? 'warning' : 'calendar'} size={14} />
      <span>
        {#if handoffMismatch}
          The coach asked about <strong>{handoffAccountPath}</strong>, but this file posts
          somewhere else. Importing is fine — it just won't close that gap.
        {:else}
          Catching up <strong>{handoffAccountPath}</strong> from
          <strong>{catchUp.from}</strong> to <strong>{catchUp.to}</strong>.
        {/if}
      </span>
    </div>
  {/if}

  {#if preview}
    <div class="transfer-window">
      <div class="section-bar">
        <ImportStepper {step} steps={STEPS} onnavigate={navigateToStep} />
      </div>

      {#if step === 'file'}
        <div class="file-summary">
          <div class="summary-head">
            <span class="file-chip">
              <Icon name="import" size={13} />
              <span class="file-name">{fileName}</span>
            </span>
            {#if importAsLiabilities}
              <span class="liability-chip">
                Imported as liabilities
                <TooltipIcon
                  label="This account is a debt, so a charge on the statement increases what you owe. Amounts are stored negated to match."
                />
              </span>
            {/if}
          </div>

          <dl class="summary-facts">
            <div class="fact">
              <dt>Parser</dt>
              <dd>{preview.parser}</dd>
            </div>
            <div class="fact">
              <dt>Rows</dt>
              <dd>{preview.transactions.length}</dd>
            </div>
            {#if dateRange}
              <div class="fact">
                <dt>Dates</dt>
                <dd>{dateRange}</dd>
              </div>
            {/if}
            <div class="fact">
              <dt>Currency</dt>
              <dd>{defaultCurrency}</dd>
            </div>
            {#if preview.errors.length > 0}
              <div class="fact">
                <dt>Unparsed</dt>
                <dd class="fact-warn">{preview.errors.length}</dd>
              </div>
            {/if}
          </dl>

          <details class="defaults">
            <summary class="defaults-summary">
              <Icon name="arrow-right" size={10} />
              <span class="defaults-label">Override</span>
              <span class="defaults-values">
                {liabilitiesOverride === null ? 'following the account' : 'set by hand'}
              </span>
            </summary>
            <div class="override-body">
              <Toggle
                checked={importAsLiabilities}
                label="Import as liabilities"
                onchange={(v) => (liabilitiesOverride = v === derivedLiabilities ? null : v)}
              />
              <p class="override-hint">
                Follows the import account's path by default. Change it only when the
                statement's signs don't match the account.
              </p>
            </div>
          </details>

          <div class="summary-actions">
            <GradientButton onclick={handleCancel}>Discard import</GradientButton>
            <GradientButton size="lg" active onclick={advanceFromFile}>
              Continue
            </GradientButton>
          </div>
        </div>
      {:else if step === 'accounts'}
        <ImportAccountsStep
          currencies={importCurrencies}
          bind:currencyAccounts
          bind:fromAccountId
          isMultiCurrency={preview.isMultiCurrency}
          {accounts}
          {rootPath}
          onaccountcreated={handleAccountCreated}
          oncontinue={advanceFromAccounts}
          onback={() => (step = 'file')}
        />
      {:else if step === 'sort'}
        <ImportSortStep
          {clusters}
          bind:clusterStates
          transactions={preview.transactions}
          {rowStates}
          {accounts}
          {groups}
          {defaultCurrency}
          applying={applyingClusters}
          onaccountcreated={handleAccountCreated}
          onapply={handleApplyClusters}
          onskip={() => (step = 'review')}
          onback={() => (step = accountsStepNeeded(preview!) ? 'accounts' : 'file')}
        />
      {/if}
    </div>

    {#if step === 'review'}
      <ImportPreviewPanel
        {preview}
        bind:rowStates
        {accounts}
        {groups}
        {currentUserId}
        {importAsLiabilities}
        {defaultCurrency}
        {loading}
        {error}
        unmappedCurrencies={unmappedCommitCurrencies}
        onaccountcreated={handleAccountCreated}
        onrowedited={handleRowEdited}
        onsaverule={handleSaveRule}
        onconfirm={() => (step = 'confirm')}
        oncancel={handleCancel}
      />
    {:else if step === 'confirm' && manifest}
      <ImportConfirmStep
        {manifest}
        transactions={preview.transactions}
        parseErrors={preview.errors}
        parserName={preview.parser}
        {importAsLiabilities}
        {loading}
        {error}
        onjumpto={jumpToRow}
        onreviewskipped={() => (step = 'review')}
        onconfirm={handleConfirm}
        onback={() => (step = 'review')}
        {coverageRange}
        coverageAccountCount={coverageAccountIds.length}
        fromCoach={catchUp !== null}
        oncoveragechange={(range) => (coverageRange = range)}
      />
    {/if}
  {:else}
    {#if resumable}
      <div class="resume-strip">
        <Icon name="restore-window" size={14} />
        <span class="resume-text">
          Resume <strong>{resumable.fileName}</strong>?
          <span class="resume-meta">
            {resumable.rowStates.length} rows · saved {describeAge(resumable.savedAt)}
          </span>
        </span>
        <div class="resume-actions">
          <GradientButton onclick={discardResumable}>Discard</GradientButton>
          <GradientButton active onclick={() => resumeSession(resumable!)}>Resume</GradientButton>
        </div>
      </div>
    {/if}

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
  {/if}
</div>

<AddParserWizard
  bind:open={showAddParser}
  {accounts}
  onSuccess={(p) => {
    parsers = [...parsers, p]
  }}
/>

<Modal title="Discard import" bind:open={showDiscardConfirm}>
  <div class="discard-modal">
    <p>
      {#if fileName}<strong>{fileName}</strong> —{/if}
      {rowStates.length} row{rowStates.length === 1 ? '' : 's'} and every account
      assignment made so far will be discarded. This cannot be undone.
    </p>
    <div class="discard-actions">
      <GradientButton onclick={() => (showDiscardConfirm = false)}>Keep working</GradientButton>
      <GradientButton variant="warning" active onclick={confirmDiscard}>
        Discard import
      </GradientButton>
    </div>
  </div>
</Modal>

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

  /* ── Resume strip (a saved import found on mount) ── */

  .resume-strip {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-md);
    background: var(--color-accent-chip-bg);
    color: var(--color-accent-chip-fg);
    border-bottom: 1px solid var(--color-rule);
    font-size: var(--text-sm);
  }

  .resume-text {
    flex: 1;
  }

  .resume-meta {
    margin-left: var(--sp-xs);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    opacity: 0.8;
  }

  .resume-actions {
    display: flex;
    gap: var(--sp-sm);
  }

  /* ── File step summary (shown once a CSV has been parsed) ── */

  .file-summary {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    padding: var(--sp-md);
  }

  .summary-head {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    flex-wrap: wrap;
  }

  .liability-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px var(--sp-sm);
    border-radius: var(--radius-pill);
    background: var(--color-accent-chip-bg);
    color: var(--color-accent-chip-fg);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .summary-facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-lg);
    margin: 0;
    padding: var(--sp-sm) var(--sp-md);
    border-radius: var(--radius-lg);
    background: var(--color-window-raised);
    box-shadow: var(--shadow-inset);
  }

  .fact {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .fact dt {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .fact dd {
    margin: 0;
    font-size: var(--text-sm);
  }

  .fact-warn {
    color: var(--color-amount-negative);
  }

  .override-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
    padding: var(--sp-sm) 0 0 var(--sp-md);
  }

  .override-hint {
    margin: 0;
    max-width: 42rem;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .summary-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-sm);
  }

  /* ── Discard confirmation ── */

  .discard-modal {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    padding: var(--sp-md);
    max-width: 30rem;
  }

  .discard-modal p {
    margin: 0;
    font-size: var(--text-sm);
  }

  .discard-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-sm);
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

  /* Says why this import exists when the coach sent the user here, so the range on the
     Confirm step later is not a surprise. */
  .coach-strip {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-raised);
    border: 1px solid var(--color-rule-soft);
    border-radius: var(--radius-lg);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .coach-strip strong {
    color: var(--color-text);
    font-weight: var(--weight-semibold);
  }

  .coach-strip.mismatch {
    color: var(--color-text);
  }
</style>
