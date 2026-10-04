<script lang="ts">
  import { onMount } from 'svelte'
  import { at } from '$lib/at'
  import { copy } from '$lib/copy'
  import { page } from '$app/state'
  import {
    fetchAccounts,
    fetchParsers,
    fetchGroups,
    importPreview,
    importCommit,
    ImportRefused,
    fetchImportSessions,
    fetchImportSession,
    saveImportSession,
    deleteImportSession,
    type ImportSessionSummary,
    checkDuplicates,
    createRule,
    type Account,
    type CsvParser,
    type CommitTransaction,
    type ExpenseGroup,
    type ParsedTransaction,
    createCoverage,
    exportJournal,
  } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import { rootsFrom, surfaceOf } from '$lib/components/accounts/accountPaths'
  import { inPreviewRows } from '$lib/import/commit-failure'
  import { errorMessage } from '$lib/copy/errors'
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
    legacySessions,
    forgetLegacySession,
    toSaved,
    isImportSession,
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

  // Export tab — optional, inclusive date bounds; both empty exports everything.
  let exportFrom = $state('')
  let exportTo = $state('')
  let exporting = $state(false)
  let exportError = $state('')

  async function handleExport() {
    exporting = true
    exportError = ''
    try {
      await exportJournal({ from: exportFrom, to: exportTo })
    } catch (e) {
      exportError = e instanceof Error ? e.message : copy.import.export.failed
    } finally {
      exporting = false
    }
  }

  let accounts = $state<Account[]>([])
  let parsers = $state<CsvParser[]>([])
  let parsersLoading = $state(true)
  // toAccountId seeds the offsetAccountId for regular rows on preview load.
  // Not required upfront — multi-currency imports may have no regular rows.
  let toAccountId = $state('')
  let fromAccountId = $state('')
  // The account the Accounts page asked us to target, if any. Read once on mount.
  let preTargetAccountId = ''
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
  // Saved imports, offered for resume on the file step until resumed or discarded (#535).
  let savedImports = $state<ImportSessionSummary[]>([])
  // The last commit's refusal for this import, mapped onto the preview's rows. Saved with the
  // session, so a resumed import still says why its last attempt failed.
  let lastError = $state<unknown>(null)
  // Set while a commit is in flight, so the autosave can't recreate the session the commit
  // deletes. Not reactive: the autosave only reads it.
  let committing = false
  // A session that won't save is worth one warning per page, not one per edit.
  let saveWarned = false

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
    { id: 'file', label: copy.import.steps.file },
    { id: 'accounts', label: copy.import.steps.accounts },
    { id: 'sort', label: copy.import.steps.sort },
    { id: 'review', label: copy.import.steps.review },
    { id: 'confirm', label: copy.import.steps.confirm },
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
    void loadSavedImports()

    // Read once on mount rather than reactively: the handoff describes how this import
    // started, and a later navigation that drops the query string must not un-start it.
    catchUp = parseCatchUpHandoff(page.url.searchParams)
    returnToCatchUp = page.url.searchParams.get('return') === 'catch-up'

    // A bare `?account=` is the Accounts page handing off a target — no date range, unlike
    // the catch-up handoff above. It only seeds the choice; the parser's own default still
    // wins once a file is parsed, and the user can change it either way.
    preTargetAccountId = page.url.searchParams.get('account') ?? ''
    if (preTargetAccountId) fromAccountId = preTargetAccountId
  })

  // --- Import as liabilities ---
  //
  // Derived from the parser's default account rather than toggled. The CSV of a credit
  // card states a charge as a positive number; posting it to a liability account means
  // storing it negated. That follows from the account, so it is shown as a fact with an
  // override available, not as a switch — flipping it mid-review silently re-signs every
  // amount in the table.
  //
  // Asked of the account's resolved type, not of where its path sits: a card at `信用卡:visa`
  // tagged Liability is a liability, and defaulting it to the un-negated sign because its root
  // is not the configured one was BUG-007 on the one surface where it flips amounts.
  let derivedLiabilities = $derived.by(() => {
    const defaultAccountId = preview?.defaultAccountId
    const account = accounts.find((a) => a.id === defaultAccountId)
    if (!account) return false
    return surfaceOf(account, rootsFrom(settingsStore.value)) === 'liabilities'
  })
  let importAsLiabilities = $derived(liabilitiesOverride ?? derivedLiabilities)

  // The span the CSV covers, for the File step's summary.
  let dateRange = $derived.by(() => {
    const dates = (preview?.transactions ?? [])
      .map((tx) => tx.date)
      .filter(Boolean)
      .sort()
    if (dates.length === 0) return ''
    const first = at(dates).slice(0, 10)
    const last = at(dates, dates.length - 1).slice(0, 10)
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
    catchUp
      ? (accounts.find((a) => a.id === catchUp!.accountId)?.path ??
          copy.import.coach.unknownAccount)
      : '',
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
  // account picker fires this per keystroke and a 200-row preview is not a small request.
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  $effect(() => {
    const snapshot = currentSession()
    const failure = $state.snapshot(lastError)
    if (!snapshot || committing) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void persist(snapshot, failure), 1500)
    return () => {
      if (saveTimer) clearTimeout(saveTimer)
    }
  })

  // Saves and discards go one at a time, in order, so a slow save can't land after a later
  // one, or after the discard or commit that was meant to end the session.
  let saving: Promise<unknown> = Promise.resolve()

  function queued<T>(work: () => Promise<T>): Promise<T> {
    const next = saving.then(work)
    saving = next.catch(() => {})
    return next
  }

  // Resolves true when the server holds the session as it is now.
  function persist(
    snapshot: ImportSession,
    failure: unknown,
  ): Promise<boolean> {
    return queued(() =>
      saveImportSession(snapshot.fileHash, toSaved(snapshot, failure)),
    ).then(
      () => true,
      (e: unknown) => {
        if (!saveWarned) {
          saveWarned = true
          toast.show(e instanceof Error ? e.message : copy.import.commit.failed)
        }
        return false
      },
    )
  }

  // Moves what this browser still holds from before #535 to the server, then lists what can
  // be resumed. A session written by another version can't be, so it is discarded here.
  async function loadSavedImports() {
    await moveLegacySessions()
    try {
      const sessions = await fetchImportSessions()
      for (const stale of sessions.filter(
        (s) => s.version !== SESSION_VERSION,
      )) {
        void discardSaved(stale.fileHash)
      }
      savedImports = sessions.filter((s) => s.version === SESSION_VERSION)
    } catch {
      savedImports = []
    }
  }

  // Each legacy session leaves this browser only once the server has it, so a failed save is
  // tried again next visit instead of losing the import. One the server already holds is not
  // sent: anything there was saved after #535, so it is newer than this browser's copy.
  async function moveLegacySessions() {
    const legacy = legacySessions()
    if (legacy.length === 0) return
    let onServer: Set<string>
    try {
      onServer = new Set((await fetchImportSessions()).map((s) => s.fileHash))
    } catch {
      return
    }
    for (const session of legacy) {
      if (onServer.has(session.fileHash) || (await persist(session, null))) {
        forgetLegacySession(session.fileHash)
      }
    }
  }

  function discardSaved(hash: string): Promise<void> {
    savedImports = savedImports.filter((s) => s.fileHash !== hash)
    return queued(() => deleteImportSession(hash)).catch(() => {})
  }

  async function resumeSaved(summary: ImportSessionSummary) {
    let saved: Awaited<ReturnType<typeof fetchImportSession>>
    try {
      saved = await fetchImportSession(summary.fileHash)
    } catch {
      toast.show(copy.import.resume.loadFailed)
      return
    }
    if (!saved) {
      savedImports = savedImports.filter((s) => s.fileHash !== summary.fileHash)
      toast.show(copy.errors.IMPORT_SESSION_NOT_FOUND)
      return
    }
    if (!isImportSession(saved.payload)) {
      toast.show(copy.import.resume.unavailable)
      void discardSaved(summary.fileHash)
      return
    }
    resumeSession(saved.payload, saved.lastError)
  }

  // Whether the commit for this file landed, read off its session: the commit deletes it in
  // the transaction that writes the rows (#535). Null when the server can't be asked either.
  async function commitLanded(hash: string): Promise<boolean | null> {
    try {
      return (await fetchImportSession(hash)) === null
    } catch {
      return null
    }
  }

  function resumeSession(saved: ImportSession, failure: unknown) {
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
    lastError = failure ?? null
    error = lastError ? errorMessage(lastError, copy.import.commit.failed) : ''
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
        if (rowStates[i]?.kind !== 'spend')
          needed.add(tx.targetCurrency.toUpperCase())
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
    if (!accountsCreated.includes(account.path))
      accountsCreated = [...accountsCreated, account.path]
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
      error = copy.import.file.required
      return
    }
    error = ''
    noParserFound = false
    loading = true
    try {
      const csvText = await file.text()
      const fetched = await importPreview(file, defaultCurrency)
      if (!fetched.isMultiCurrency) {
        // The parser's remembered account wins; the hand-off is the fallback, so arriving
        // from the Accounts page with a CSV whose parser knows no default still lands on
        // the account you came from rather than on nothing.
        fromAccountId = fetched.defaultAccountId ?? preTargetAccountId
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
      // rows pass an empty accountId and are skipped by the guess.
      //
      // Every row also sends its key and the account its file is the statement of, for the
      // certain check. That account follows the backend's `statementAccountId`: the account
      // the money left, or for a same-currency transfer the one that received it.
      const statementAccount = (tx: ParsedTransaction): string => {
        const inCurrency = (currency: string) =>
          fetched.isMultiCurrency
            ? (currencyAccounts[currency.toUpperCase()] ?? '')
            : fromAccountId
        if (tx.isTransfer === true) return inCurrency(tx.sourceCurrency)
        if (tx.isTransfer === 'same-currency') return inCurrency(tx.currency)
        return inCurrency(tx.currency ?? defaultCurrency) || fromAccountId
      }
      const checkRows = fetched.transactions.map((tx) => ({
        importKey: tx.importKey,
        importAccountId: statementAccount(tx),
        accountId:
          tx.isTransfer === false
            ? fetched.isMultiCurrency
              ? (currencyAccounts[
                  (tx.currency ?? defaultCurrency).toUpperCase()
                ] ?? '')
              : (fetched.defaultAccountId ?? '')
            : '',
        date: tx.date,
        amount: tx.isTransfer === false ? tx.amount : '0',
        // A match must be in the same currency: 8,400 JPY is not 8,400 CAD.
        currency: (
          (tx.isTransfer === false ? tx.currency : undefined) ?? defaultCurrency
        ).toUpperCase(),
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
          !!tx.suggestedGroupId &&
          !(tx.isTransfer === true && tx.suggestedKind === 'transfer')

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
          categoryId: isSplitSuggestion
            ? (tx.suggestedCategoryId ?? null)
            : null,
          // Cross-currency rows default to spend unless the preview flagged a convert-and-park.
          kind:
            tx.isTransfer === true ? (tx.suggestedKind ?? 'spend') : 'spend',
          // Spend rows pre-fill the expense account from the import rule, else fall back to the
          // uncategorized account so the spend is still importable and surfaces for review.
          // A split row leaves it empty — its expense leg derives from the category at commit.
          expenseAccountId:
            tx.isTransfer === true &&
            tx.suggestedKind !== 'transfer' &&
            !isSplitSuggestion
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
      // leaving a second copy behind, and starts its attempts afresh.
      lastError = null
      clusterStates = []
      rulesCreated = []
      accountsCreated = []
      // Both middle steps are skipped when they have nothing to ask: Accounts when every
      // currency already resolved on seed, Sort when no merchant repeats.
      if (accountsStepNeeded(fetched)) {
        step = 'accounts'
      } else if (
        buildClusters(fetched.transactions, defaultCurrency).length > 0
      ) {
        clusterStates = buildClusters(
          fetched.transactions,
          defaultCurrency,
        ).map(initialClusterState)
        step = 'sort'
      } else {
        step = 'review'
      }
    } catch (e) {
      error = e instanceof Error ? e.message : copy.import.file.parseFailed
      // Compared with the copy entry itself rather than a phrase inside it, so rewording the
      // sentence cannot quietly turn the hint off.
      noParserFound = error === copy.errors.NO_PARSER_MATCHED
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
    clusterStates = clusters.map(
      (c) => previous.get(c.key) ?? initialClusterState(c),
    )
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
          rowStates[i] = applyTarget(
            at(preview.transactions, i),
            at(rowStates, i),
            target,
            'cluster',
          )
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
            if (!rulesCreated.includes(cluster.key))
              rulesCreated = [...rulesCreated, cluster.key]
          } catch (e) {
            toast.show(
              copy.import.sort.ruleFailed(
                cluster.key,
                e instanceof Error ? e.message : copy.import.sort.unknownError,
              ),
            )
          }
        }
      }

      toast.show(copy.import.sort.applied(written, created))
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
      : {
          accountId:
            tx.isTransfer === true ? row.expenseAccountId : row.offsetAccountId,
        }
    if (!row.groupId && !target.accountId) return

    try {
      await createRule({ pattern: tx.merchantKey, ...target })
      if (!rulesCreated.includes(tx.merchantKey))
        rulesCreated = [...rulesCreated, tx.merchantKey]
    } catch (e) {
      toast.show(e instanceof Error ? e.message : copy.import.commit.ruleFailed)
      return
    }

    const rowTarget: RowTarget = row.groupId
      ? { kind: 'split', groupId: row.groupId, categoryId: row.categoryId }
      : { kind: 'account', accountId: target.accountId! }
    const matches = rowsMatchingPattern(
      preview!.transactions,
      rowStates,
      tx.merchantKey,
    )
    for (const i of matches) {
      rowStates[i] = applyTarget(
        at(preview!.transactions, i),
        at(rowStates, i),
        rowTarget,
        'cluster',
      )
    }

    toast.show(copy.import.commit.ruleSaved(tx.merchantKey, matches.length))
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
      error = copy.import.commit.fromRequired
      return
    }
    // The Accounts step covers every currency the preview expected. This catches the tail:
    // a row flipped to convert-and-park after that step introduces a target currency the
    // step never asked about. Name the currencies rather than saying "some account".
    if (unmappedCommitCurrencies.length > 0) {
      error = copy.import.commit.unmapped(
        unmappedCommitCurrencies.length,
        unmappedCommitCurrencies.join(', '),
      )
      return
    }
    const invalid = preview.transactions.some((tx, i) => {
      const row = at(rowStates, i)
      return !row.skipped && rowMissingAccounts(tx, row)
    })
    if (invalid) {
      error = copy.import.commit.incomplete
      return
    }
    // The preview index of each row sent, in order: a refusal names its row by position in
    // the request, which skips the rows the user skipped.
    const sent = preview.transactions.flatMap((_, i) =>
      at(rowStates, i).skipped ? [] : [i],
    )
    loading = true
    error = ''
    // Hold the autosave and put the session on the server as it is now. The commit deletes it
    // on the way through, so if the answer is lost its absence says the rows landed (#535).
    committing = true
    if (saveTimer) clearTimeout(saveTimer)
    const snapshot = currentSession()
    const receipt = snapshot
      ? await persist(snapshot, $state.snapshot(lastError))
      : false
    let landed: string | null = null
    try {
      const txs: CommitTransaction[] = preview.transactions.flatMap(
        (parsed, i) => {
          const row = at(rowStates, i)
          if (row.skipped) return []
          // A row already imported for certain that the user chose to import anyway goes
          // without its key, so the backend writes it as a new transaction instead of
          // skipping it.
          const tx = row.possibleDuplicate?.certain
            ? { ...parsed, importKey: undefined }
            : parsed
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
                importKey: tx.importKey,
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
        },
      )
      // Build groupSplits re-indexed to txs positions (skipped rows excluded from txs)
      const groupSplits: {
        rowIndex: number
        groupId: string
        categoryId: string | null
      }[] = []
      let txIdx = 0
      for (const row of rowStates) {
        if (row.skipped) continue
        if (row.groupId !== null) {
          groupSplits.push({
            rowIndex: txIdx,
            groupId: row.groupId,
            categoryId: row.categoryId,
          })
        }
        txIdx++
      }

      const result = await importCommit({
        accountId: fromAccountId,
        defaultCurrency,
        transactions: txs,
        groupSplits: groupSplits.length > 0 ? groupSplits : undefined,
        // Named whether or not the last save went through: an older copy is just as finished.
        // Only reading its absence afterwards needs `receipt`.
        session: fileHash || undefined,
      })
      landed = copy.import.commit.imported({
        created: result.created,
        fishPie: result.fishPieExpenses,
        skipped: result.skipped,
      })
    } catch (e) {
      // The session is left as it was, so the user can fix the row and confirm again.
      if (e instanceof ImportRefused) {
        lastError = inPreviewRows(e.body, sent)
        error = errorMessage(lastError, copy.import.commit.failed)
      } else {
        // No answer: the connection dropped, or something in front of the API answered for
        // it (`ImportUnanswered`, a proxy's 502 or 504). The session says whether the rows
        // went in, if it was saved before the commit.
        const gone = receipt ? await commitLanded(fileHash) : null
        if (gone) landed = copy.import.commit.landed
        else
          error =
            gone === false
              ? copy.import.commit.failed
              : copy.import.commit.unknown
      }
    } finally {
      loading = false
    }
    if (landed) await finishImport(landed)
    else committing = false
  }

  // After a commit landed: say so, record what the file covered, and leave for what was
  // imported. Outside the commit's `try`, so nothing here can read as a failed import.
  async function finishImport(message: string) {
    toast.show(message)
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
        toast.show(copy.import.commit.coverageFailed)
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
      goto(
        range
          ? `/transactions?from=${range.from}&to=${range.to}`
          : '/transactions',
      )
    }
  }

  // Drops the in-progress import from the page. The saved copy is the commit's to delete, or
  // `discardSaved`'s; callers confirm first where the work would be lost rather than committed.
  function resetSession() {
    if (saveTimer) clearTimeout(saveTimer)
    lastError = null
    committing = false
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
    const hash = fileHash
    resetSession()
    error = ''
    if (hash) void discardSaved(hash)
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
          {copy.import.coach.askedAbout} <strong>{handoffAccountPath}</strong>
          · {copy.import.coach.mismatch}
        {:else}
          {copy.import.coach.catchingUp} <strong>{handoffAccountPath}</strong>
          · <strong>{catchUp.from}</strong> → <strong>{catchUp.to}</strong>
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
                {copy.import.page.liabilities}
                <TooltipIcon label={copy.import.summary.liabilitiesHint} />
              </span>
            {/if}
          </div>

          <dl class="summary-facts">
            <div class="fact">
              <dt>{copy.import.summary.facts.parser}</dt>
              <dd>{preview.parser}</dd>
            </div>
            <div class="fact">
              <dt>{copy.import.summary.facts.rows}</dt>
              <dd>{preview.transactions.length}</dd>
            </div>
            {#if dateRange}
              <div class="fact">
                <dt>{copy.import.summary.facts.dates}</dt>
                <dd>{dateRange}</dd>
              </div>
            {/if}
            <div class="fact">
              <dt>{copy.import.summary.facts.currency}</dt>
              <dd>{defaultCurrency}</dd>
            </div>
            {#if preview.errors.length > 0}
              <div class="fact">
                <dt>{copy.import.summary.facts.unparsed}</dt>
                <dd class="fact-warn">{preview.errors.length}</dd>
              </div>
            {/if}
          </dl>

          <details class="defaults">
            <summary class="defaults-summary">
              <Icon name="arrow-right" size={10} />
              <span class="defaults-label">{copy.import.summary.override}</span>
              <span class="defaults-values">
                {liabilitiesOverride === null
                  ? copy.import.summary.following
                  : copy.import.summary.byHand}
              </span>
            </summary>
            <div class="override-body">
              <Toggle
                checked={importAsLiabilities}
                label={copy.import.summary.importAsLiabilities}
                onchange={(v) =>
                  (liabilitiesOverride = v === derivedLiabilities ? null : v)}
              />
              <p class="override-hint">
                {copy.import.summary.overrideHint}
              </p>
            </div>
          </details>

          <div class="summary-actions">
            <GradientButton onclick={handleCancel}
              >{copy.import.summary.discard}</GradientButton
            >
            <GradientButton size="lg" active onclick={advanceFromFile}>
              {copy.import.summary.continue}
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
          onback={() =>
            (step = accountsStepNeeded(preview!) ? 'accounts' : 'file')}
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
    {#each savedImports as saved (saved.fileHash)}
      <div class="resume-strip">
        <Icon name="restore-window" size={14} />
        <span class="resume-text">
          {copy.import.resume.lead} <strong>{saved.fileName}</strong>
          <span class="resume-meta">
            {copy.import.resume.meta(
              saved.rowCount,
              describeAge(saved.savedAt),
            )}
          </span>
          {#if saved.lastError}
            <span class="resume-error">
              {copy.import.resume.lastFailed(
                errorMessage(saved.lastError, copy.import.commit.failed),
              )}
            </span>
          {/if}
        </span>
        <div class="resume-actions">
          <GradientButton onclick={() => discardSaved(saved.fileHash)}
            >{copy.import.resume.discard}</GradientButton
          >
          <GradientButton active onclick={() => resumeSaved(saved)}
            >{copy.import.resume.resume}</GradientButton
          >
        </div>
      </div>
    {/each}

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
            {copy.import.page.tabs.import}
          </button>
          <button
            type="button"
            class="tab"
            class:active={activeTab === 'export'}
            aria-pressed={activeTab === 'export'}
            onclick={() => (activeTab = 'export')}
          >
            <Icon name="export" size={13} />
            {copy.import.page.tabs.export}
          </button>
          <a class="tab tab-link" href="/import/rules">
            <Icon name="settings" size={13} />
            {copy.import.page.tabs.rules}
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
                <span class="file-size"
                  >{copy.import.file.size((file.size / 1024).toFixed(1))}</span
                >
                <button
                  type="button"
                  class="file-clear"
                  aria-label={copy.import.file.remove}
                  onclick={clearFile}>✕</button
                >
              </span>
              <GradientButton type="submit" size="lg" disabled={loading} active>
                {loading ? copy.import.file.parsing : copy.import.file.preview}
              </GradientButton>
            {:else}
              <label class="choose-btn">
                <Icon name="import" size={14} />
                {copy.import.file.choose}
                <input
                  id="csv-file"
                  type="file"
                  accept=".csv"
                  class="file-input-hidden"
                  onchange={(e) => {
                    file =
                      (e.currentTarget as HTMLInputElement).files?.[0] ?? null
                  }}
                />
              </label>
              <span class="drop-hint">
                {copy.import.file.dropHint}
                <span class="pacman"
                  ><Icon name="pacman" size={14} /><Icon
                    name="dot"
                    size={6}
                  /><Icon name="dot" size={6} /><Icon
                    name="cherry"
                    size={12}
                  /></span
                >
              </span>
            {/if}
          </div>

          <details class="defaults">
            <summary class="defaults-summary">
              <Icon name="arrow-right" size={10} />
              <span class="defaults-label">{copy.import.file.defaults}</span>
              <span class="defaults-values">
                {defaultCurrency} ·
                {accounts.find((a) => a.id === toAccountId)?.path ??
                  copy.import.file.noUncategorized}
              </span>
            </summary>
            <div class="import-fields">
              <div class="import-field">
                <label class="import-label" for="default-currency">
                  {copy.import.file.defaultCurrency}
                  <TooltipIcon label={copy.import.file.defaultCurrencyHint} />
                </label>
                <CurrencyInput
                  id="default-currency"
                  bind:value={defaultCurrency}
                  style="width: 5rem"
                />
              </div>
              <div class="import-field import-account">
                <span class="import-label">
                  {copy.import.file.uncategorized}
                  <TooltipIcon label={copy.import.file.uncategorizedHint} />
                </span>
                <AccountPicker
                  {accounts}
                  bind:value={toAccountId}
                  placeholder={copy.import.file.accountPlaceholder}
                  oncreate={handleAccountCreated}
                />
              </div>
            </div>
          </details>

          {#if error}
            <div class="error-strip">
              <span class="error-text">{error}</span>
              {#if noParserFound}
                <span class="hint-text">{copy.import.file.noParserHint}</span>
                <GradientButton
                  onclick={() => {
                    showAddParser = true
                  }}
                >
                  {copy.import.file.noParserAction}
                </GradientButton>
              {/if}
            </div>
          {/if}
        </form>
      {:else}
        <div class="export-body">
          <p class="export-blurb">
            {copy.import.export.blurb}
          </p>

          <div class="import-fields">
            <div class="import-field">
              <label class="import-label" for="export-from">
                {copy.import.export.from}
                <TooltipIcon label={copy.import.export.fromHint} />
              </label>
              <input
                id="export-from"
                type="date"
                class="date-input"
                bind:value={exportFrom}
                disabled={exporting}
              />
            </div>
            <div class="import-field">
              <label class="import-label" for="export-to"
                >{copy.import.export.to}</label
              >
              <input
                id="export-to"
                type="date"
                class="date-input"
                bind:value={exportTo}
                disabled={exporting}
              />
            </div>
          </div>

          <div class="actions-bar">
            <GradientButton
              size="lg"
              disabled={exporting}
              onclick={handleExport}
            >
              <Icon name="export" size={14} />
              {exporting ? copy.import.export.running : copy.import.export.run}
            </GradientButton>
          </div>

          {#if exportError}
            <div class="error-strip">
              <span class="error-text">{exportError}</span>
            </div>
          {/if}
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

<Modal title={copy.import.discard.title} bind:open={showDiscardConfirm}>
  <div class="discard-modal">
    <p>
      {#if fileName}<strong>{fileName}</strong> —{/if}
      {copy.import.discard.body(rowStates.length)}
    </p>
    <div class="discard-actions">
      <GradientButton onclick={() => (showDiscardConfirm = false)}
        >{copy.import.discard.keep}</GradientButton
      >
      <GradientButton variant="warning" active onclick={confirmDiscard}>
        {copy.import.discard.confirm}
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
    font-size: var(--text-body);
  }

  .resume-text {
    flex: 1;
  }

  .resume-meta {
    margin-left: var(--sp-xs);
    font-family: var(--font-mono);
    font-size: var(--text-dense);
    opacity: 0.8;
  }

  .resume-actions {
    display: flex;
    gap: var(--sp-sm);
  }

  .resume-error {
    display: block;
    color: var(--color-danger);
    font-size: var(--text-dense);
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
    gap: var(--sp-3xs);
    padding: var(--sp-4xs) var(--sp-sm);
    border-radius: var(--radius-pill);
    background: var(--color-accent-chip-bg);
    color: var(--color-accent-chip-fg);
    font-family: var(--font-mono);
    font-size: var(--text-label);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-label);
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
    gap: var(--sp-4xs);
  }

  .fact dt {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .fact dd {
    margin: 0;
    font-size: var(--text-body);
  }

  .fact-warn {
    color: var(--color-warning);
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
    font-size: var(--text-dense);
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
    font-size: var(--text-body);
  }

  .discard-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-sm);
  }

  /* ── Tabs ── */

  .tabs {
    display: flex;
    gap: var(--sp-4xs);
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2xs);
    padding: var(--sp-2xs) var(--gutter);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    font-family: var(--font-mono);
    font-size: var(--text-label);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-label);
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
    outline: 2px solid var(--color-accent-hi);
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
    border-color: var(--color-accent-hi);
    border-style: solid;
    background: var(--color-accent-chip-bg);
  }

  .choose-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2xs);
    height: 32px;
    padding: 0 var(--sp-md);
    background: linear-gradient(
      180deg,
      var(--color-btn-gradient-hi),
      var(--color-rule-soft)
    );
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }

  .choose-btn:hover {
    background: linear-gradient(
      180deg,
      var(--color-btn-gradient-hi),
      var(--color-accent-chip-bg)
    );
    border-color: var(--color-accent);
  }

  .choose-btn:focus-within {
    outline: 2px solid var(--color-accent-hi);
    outline-offset: 1px;
  }

  .drop-hint {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2xs);
    font-size: var(--text-dense);
    color: var(--color-text-disabled);
  }

  .pacman {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-3xs);
    color: var(--color-text-disabled);
  }

  .file-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-2xs) var(--sp-2xs) var(--sp-2xs) var(--gutter-tight);
    background: var(--color-accent-chip-bg);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-pill);
    color: var(--color-text);
  }

  .file-name {
    font-family: var(--font-mono);
    font-size: var(--text-body);
    color: var(--color-text);
  }

  .file-size {
    font-family: var(--font-mono);
    font-size: var(--text-dense);
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
    font-size: var(--text-control);
    line-height: var(--leading-none);
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
    gap: var(--sp-2xs);
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
    font-size: var(--text-label);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .defaults-values {
    font-family: var(--font-mono);
    font-size: var(--text-dense);
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
    gap: var(--sp-3xs);
    font-family: var(--font-mono);
    font-size: var(--text-label);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-label);
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .date-input {
    height: 28px;
    padding: 0 var(--sp-xs);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-inset);
    font-family: var(--font-mono);
    font-size: var(--text-body);
    color: var(--color-text);
  }

  .date-input:focus-visible {
    outline: 2px solid var(--color-accent-hi);
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
    font-size: var(--text-body);
    line-height: var(--leading-normal);
    color: var(--color-text-muted);
    max-width: 52ch;
  }

  /* ── Error strip ── */

  .error-strip {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-md);
    background: var(--color-danger-light);
    font-size: var(--text-dense);
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
    gap: var(--sp-2xs);
    margin-bottom: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-raised);
    border: 1px solid var(--color-rule-soft);
    border-radius: var(--radius-lg);
    font-size: var(--text-dense);
    color: var(--color-text-muted);
  }

  .coach-strip strong {
    color: var(--color-text);
    font-weight: var(--weight-bold);
  }

  .coach-strip.mismatch {
    color: var(--color-text);
  }
</style>
