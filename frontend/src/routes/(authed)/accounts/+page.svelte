<script lang="ts">
  import { onMount } from 'svelte'
  import { copy } from '$lib/copy'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import Checkbox from '$lib/components/ui/Checkbox.svelte'
  import ControlBar from '$lib/components/ui/ControlBar.svelte'
  import SearchField from '$lib/components/ui/SearchField.svelte'
  import Chip from '$lib/components/ui/Chip.svelte'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import ConvertToggle from '$lib/components/ui/ConvertToggle.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Select from '$lib/components/ui/Select.svelte'
  import SelectionTray from '$lib/components/ui/SelectionTray.svelte'
  import Shimmer from '$lib/components/ui/Shimmer.svelte'
  import TabStrip, { type TabItem } from '$lib/components/ui/TabStrip.svelte'
  import AddAccountWizard from '$lib/components/wizards/AddAccountWizard.svelte'
  import AccountDrawer from '$lib/components/accounts/AccountDrawer.svelte'
  import AccountFlags from '$lib/components/accounts/AccountFlags.svelte'
  import CategoriesTab from '$lib/components/accounts/CategoriesTab.svelte'
  import Sheet, {
    WIDTH,
    type SheetColumn,
  } from '$lib/components/ui/Sheet.svelte'
  import SheetBand from '$lib/components/ui/SheetBand.svelte'
  import {
    fetchAccountBalances,
    fetchAccountPostingCounts,
    fetchCoverageStatus,
    fetchFxRateAsOf,
    toClassifierType,
    updateAccount,
  } from '$lib/api'
  import type {
    AccountBalance,
    AccountCoverageStatus,
    UserSettings,
  } from '$lib/api'
  import { completeness, completenessNote, coverageFor } from '$lib/coverage'
  import { actionRequiredStore } from '$lib/actionRequired.svelte'
  import { attentionChip } from '$lib/components/transactions/attentionChip'
  import { settingsStore } from '$lib/settings.svelte'
  import { toast } from '$lib/toast.svelte'
  import { bump as refreshSidebar } from '$lib/sidebarRefresh.svelte'
  import { SUPPORTED_CURRENCIES } from '$lib/currency'
  import { toISODate } from '$lib/date'
  import { rank } from '$lib/components/accounts/accountScorer'
  import {
    NO_RATES,
    conversionNote,
    formatCents,
    formatCentsAbs,
    toCents,
    type Rates,
  } from '$lib/money'
  import {
    ACCOUNT_SURFACES,
    rootFor,
    rootsFrom,
    type PositionBucket,
  } from '$lib/components/accounts/accountPaths'
  import {
    protectionFor,
    protectionMessage,
    type Protection,
  } from '$lib/components/accounts/accountRoles'
  import {
    STALE_AFTER_DAYS,
    buildRows,
    convertRows,
    currenciesNeedingRates,
    groupCurrency,
    groupRows,
    positionAccountIds,
    positionTotals,
    type Grouping,
    type Group,
    type Row,
  } from '$lib/components/accounts/accountsOverview'

  // ── Tab, mirrored in the URL ──────────────────────────────
  // `?tab=` keeps the two halves of the page linkable — story 7 redirects the retired
  // /accounts/manage route straight at the Categories tab.
  const TABS: TabItem[] = [
    { id: 'accounts', label: copy.accounts.page.tabs.accounts },
    { id: 'categories', label: copy.accounts.page.tabs.categories },
  ]

  // "Available", not "Cash": unconverted, the figure is the preferred-currency balance and
  // nothing else, and "Cash" invites the question "so where is my USD?" that the card is not
  // answering. Owing reads as a magnitude under its own label rather than a signed figure —
  // a card that owes 3,759 is not an error, and a minus sign there is an alarm that never
  // stops going off.
  //
  // `neutralSign` is the other half of the same idea. `bucketOf` maps equity into
  // investments, and equity is negative by construction — a 30,000 opening balance is
  // bookkeeping, not a loss — so deriving alarm from `cents < 0` painted the only red
  // figure on the page onto the one number that is always going to be negative. Available
  // and Owed still take the colour when they go negative, because there it means something.
  // The label is looked up by key rather than carried here, so the four names sit
  // together in the copy file where the voice of the row can be read at once.
  const POSITION_CARDS: {
    key: PositionBucket
    magnitude?: boolean
    neutralSign?: boolean
  }[] = [
    { key: 'cash' },
    { key: 'investments', neutralSign: true },
    { key: 'owed' },
    { key: 'owing', magnitude: true },
  ]

  // ── The column geometry ───────────────────────────────────
  // One list, one grid (DESIGN.md §5). Balance used to sit at a different x in every group
  // because each group rendered its own auto-sized table; declaring the widths here and
  // handing them to a single sheet is the whole fix.
  //
  // Account takes the remainder — it is what the row is about. Everything else is sized to
  // its worst case from the shared vocabulary, so a column that means the same thing on the
  // Categories tab is the same width there.
  let columns = $derived.by<SheetColumn[]>(() => [
    { key: 'account', label: copy.accounts.columns.account },
    { key: 'type', label: copy.accounts.columns.type, width: WIDTH.chip },
    {
      key: 'balance',
      label: copy.accounts.columns.balance,
      width: WIDTH.money,
      numeric: true,
    },
    ...(converted
      ? [
          {
            key: 'converted',
            label: copy.accounts.columns.converted(preferred),
            width: WIDTH.converted,
            numeric: true,
          } satisfies SheetColumn,
        ]
      : []),
    {
      key: 'activity',
      label: copy.accounts.columns.activity,
      width: WIDTH.date,
    },
    { key: 'flags', label: copy.accounts.columns.flags, width: WIDTH.flags },
    {
      key: 'actions',
      label: copy.accounts.columns.actions,
      width: WIDTH.actions,
      unlabelled: true,
    },
  ])

  function tabFromUrl(url: URL): string {
    const t = url.searchParams.get('tab')
    return TABS.some((x) => x.id === t) ? t! : 'accounts'
  }

  // The URL is the only place the active tab lives. A click writes the URL and the panel
  // follows it, so there is no second copy to fall out of step — an earlier version mirrored
  // the tab into `$state` and kept the two in sync with a pair of effects, where the
  // URL-follower re-ran on every click and put the old tab back before the click could be
  // recorded. Deriving it means that cannot be written.
  const activeTab = $derived(tabFromUrl(page.url))

  function selectTab(tab: string) {
    const url = new URL(page.url)
    url.searchParams.set('tab', tab)
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true })
  }

  // ── Data ──────────────────────────────────────────────────
  let accounts = $state<AccountBalance[]>([])
  let lastActivityById = $state<Map<string, string | null>>(new Map())
  // Absent ids are not contributors — hidden, illiquid, dismissed, or not the kind of account
  // you fall behind on. `coverageToday` is the server's calendar day, so a tile does not read
  // as complete through a date the ledger has not reached.
  let coverageById = $state<Map<string, AccountCoverageStatus>>(new Map())
  let coverageToday = $state<string | null>(null)
  let settings = $state<UserSettings | null>(null)
  let rates = $state<Rates>(new Map())
  let loading = $state(true)
  let error = $state<string | null>(null)

  const today = toISODate(new Date())

  onMount(async () => {
    try {
      const [balances, counts, coverage, loaded] = await Promise.all([
        fetchAccountBalances({ includeUnfiled: true }),
        fetchAccountPostingCounts(),
        fetchCoverageStatus(),
        settingsStore.load(),
      ])
      accounts = balances
      lastActivityById = new Map(
        counts.map((c) => [c.accountId, c.lastActivity]),
      )
      coverageById = new Map(coverage.accounts.map((a) => [a.accountId, a]))
      coverageToday = coverage.today
      settings = loaded
      // The layout loads the attention summary once at start-up and caches it. This page is
      // now where that signal is read, and the fix for it happens elsewhere — the account
      // page, the transactions list — so a cached count would keep pointing at work already
      // done. One small request per visit is the cost of the number being true.
      actionRequiredStore.invalidate()
      void actionRequiredStore.load()
    } catch {
      error = copy.accounts.toasts.loadFailed
    } finally {
      loading = false
    }
  })

  let preferred = $derived(settings?.preferredCurrency ?? 'CAD')

  let roots = $derived(rootsFrom(settings))

  let hiddenIds = $derived(
    new Set(settings?.preferences.hiddenAccountIds ?? []),
  )

  // Every account the Accounts tab is responsible for: the three balance-bearing roots plus
  // anything unfiled. Categories owns expenses and income (story 5).
  let allRows = $derived(
    buildRows(accounts, roots, lastActivityById, today).filter((r) =>
      ACCOUNT_SURFACES.includes(r.surface),
    ),
  )

  // ── Conversion, on request only ───────────────────────────
  // The page opens unconverted. Every figure is then the preferred-currency balance alone:
  // exact, complete on its own terms, and true without a single rate lookup. Converting is a
  // deliberate act — "what is all of this worth in CAD" is a question asked occasionally, not
  // a reason to hit the FX endpoint on every visit to a page that is mostly about navigation.
  let converted = $state(false)
  let converting = $state(false)
  let convertError = $state<string | null>(null)

  let foreignCurrencies = $derived(currenciesNeedingRates(allRows, preferred))

  // The rates every figure on the page reads. Empty until asked, which is what makes the
  // resting state the preferred currency alone rather than a partial sum.
  let activeRates = $derived(converted ? rates : NO_RATES)

  // Only the currencies still without a rate are fetched, so a second click is a retry for
  // what failed rather than a re-request of what already succeeded.
  async function loadRates() {
    const wanted = foreignCurrencies.filter((c) => !rates.has(c))
    if (wanted.length === 0) return
    const pairs = await Promise.all(
      wanted.map(async (from) => {
        const r = await fetchFxRateAsOf(from, preferred).catch(() => null)
        const rate = r ? Number(r.rate) : NaN
        return [from, Number.isFinite(rate) ? rate : null] as const
      }),
    )
    const next = new Map(rates)
    for (const [from, rate] of pairs) if (rate !== null) next.set(from, rate)
    rates = next
  }

  async function toggleConvert() {
    convertError = null
    if (converted) {
      converted = false
      return
    }
    converting = true
    try {
      await loadRates()
      // Not a single rate resolved, so there is nothing to convert *to*: stay in the native
      // view rather than switching into a column of dashes and calling that a conversion.
      // A partial failure does convert, and says what it missed per figure.
      if (rates.size === 0) {
        convertError = copy.accounts.conversion.noRates(preferred)
        return
      }
      converted = true
    } finally {
      converting = false
    }
  }

  // ── Attention ─────────────────────────────────────────────
  // The summary the layout already loads. Until this story it reached exactly one surface —
  // a 6px dot in the sidebar — and the sidebar stopped listing accounts in story 4, so this
  // page is now the only place an unfinished entry is visible outside the account itself.
  function attentionFor(id: string): number | null {
    return actionRequiredStore.getCount(id)
  }

  let needAttention = $derived(
    allRows.filter((r) => (attentionFor(r.account.id) ?? 0) > 0),
  )

  let attentionTotal = $derived(
    needAttention.reduce(
      (sum, r) => sum + (attentionFor(r.account.id) ?? 0),
      0,
    ),
  )

  let attentionOnly = $state(false)

  // A chip that filters to nothing is a trap, so it clears itself the moment the last
  // account it was scoping gets cleaned up.
  $effect(() => {
    if (attentionOnly && needAttention.length === 0) attentionOnly = false
  })

  // ── Controls ──────────────────────────────────────────────
  let query = $state('')
  let grouping = $state<Grouping>('institution')
  let show = $state<'active' | 'all' | 'hidden'>('active')

  let shownRows = $derived(
    allRows.filter((r) => {
      const hidden = hiddenIds.has(r.account.id)
      const visible =
        show === 'all' ? true : show === 'hidden' ? hidden : !hidden
      return (
        visible && (!attentionOnly || (attentionFor(r.account.id) ?? 0) > 0)
      )
    }),
  )

  // Search narrows, it does not reorder: the grouping is the organising principle, and a
  // relevance-sorted list would tear the groups apart mid-query.
  let matchedIds = $derived.by(() => {
    const q = query.trim()
    if (!q) return null
    return new Set(
      rank(
        q,
        shownRows.map((r) => ({ path: r.account.path, id: r.account.id })),
      ).map((m) => m.id),
    )
  })

  let visibleRows = $derived(
    matchedIds
      ? shownRows.filter((r) => matchedIds.has(r.account.id))
      : shownRows,
  )

  let groups = $derived(groupRows(visibleRows, grouping))

  // The position row describes the money you track, so it is computed over your active
  // accounts and does not move as you search, regroup, or peek at hidden rows.
  let positionRows = $derived(
    allRows.filter((r) => !hiddenIds.has(r.account.id)),
  )

  let position = $derived(
    positionTotals(positionRows, roots, activeRates, preferred),
  )

  // Each tile's as-of, over the same rows the tile sums — the four differ, and that is the
  // point: Owed to you can be current while Available is two months behind.
  let positionNotes = $derived.by(() => {
    const today = coverageToday
    if (!today) return null
    const ids = positionAccountIds(positionRows, roots)
    return {
      cash: completenessNote(
        completeness(coverageFor(coverageById, ids.cash)),
        today,
      ),
      investments: completenessNote(
        completeness(coverageFor(coverageById, ids.investments)),
        today,
      ),
      owed: completenessNote(
        completeness(coverageFor(coverageById, ids.owed)),
        today,
      ),
      owing: completenessNote(
        completeness(coverageFor(coverageById, ids.owing)),
        today,
      ),
    }
  })

  // ── What is outstanding ───────────────────────────────────
  // Two kinds of unfinished work reach this page, and they are not the same thing: entries
  // that need a decision, and accounts that have never had a starting line so nothing about
  // them can be dated at all. Both make the figures below provisional, which is why the
  // header keys off them rather than reporting them as an aside.
  let unbootstrapped = $derived.by(() => {
    if (!coverageToday) return 0
    const ids = positionAccountIds(positionRows, roots)
    const all = [...ids.cash, ...ids.investments, ...ids.owed, ...ids.owing]
    return completeness(coverageFor(coverageById, all)).unknown
  })

  let outstanding = $derived(attentionTotal > 0 || unbootstrapped > 0)

  // ── Curation ──────────────────────────────────────────────
  // Pins and hides live in the free-form `preferences` JSONB, the same way hiddenAccountIds
  // already does, so neither needs a migration.
  let pinnedIds = $derived(
    new Set(settings?.preferences.pinnedAccountIds ?? []),
  )

  /** Writes a preferences patch and keeps the local copy in step with the store. */
  async function savePreferences(patch: {
    pinnedAccountIds?: string[]
    hiddenAccountIds?: string[]
  }) {
    const current = settingsStore.value
    if (!current) return
    try {
      await settingsStore.update({
        preferences: { ...current.preferences, ...patch },
      })
      settings = settingsStore.value
    } catch {
      toast.show(copy.accounts.toasts.saveFailed)
    }
  }

  function withId(
    list: readonly string[],
    id: string,
    present: boolean,
  ): string[] {
    const without = list.filter((x) => x !== id)
    return present ? [...without, id] : without
  }

  async function setPinned(ids: readonly string[], pinned: boolean) {
    let next = settings?.preferences.pinnedAccountIds ?? []
    for (const id of ids) next = withId(next, id, pinned)
    await savePreferences({ pinnedAccountIds: next })
  }

  async function setHidden(ids: readonly string[], hidden: boolean) {
    let next = settings?.preferences.hiddenAccountIds ?? []
    for (const id of ids) next = withId(next, id, hidden)
    await savePreferences({ hiddenAccountIds: next })
    // The Active view filters hidden accounts out, so the row the user just acted on
    // disappears. Say where it went rather than leaving them to wonder what they deleted.
    if (hidden && show === 'active') {
      toast.show(copy.accounts.toasts.hidden(ids.length))
    }
  }

  /** Null when the account is free to hide; a reason when something depends on it. */
  function protection(row: Row): Protection | null {
    return protectionFor(row.account, settings, roots)
  }

  // ── Selection ─────────────────────────────────────────────
  // Pinning six Wise accounts one at a time is six round trips, so the pinned sidebar only
  // survives if curating is cheap. Selection is by id rather than by row, so it holds while
  // you regroup or search.
  //
  // It is a mode rather than a permanent column. A checkbox in front of every account is
  // 14px of chrome leading every row of the page, ahead of the thing you came to read, for
  // an action most visits never take — and it was also the reason selection could not simply
  // be a click on the row. The transactions page already works this way; this is that.
  let selectMode = $state(false)
  let selectedIds = $state<Set<string>>(new Set())

  function toggleSelectMode() {
    selectMode = !selectMode
    selectedIds = new Set()
  }

  // Rows that left the view take their selection with them — acting on a row you can no
  // longer see is exactly the surprise a bulk bar must not spring.
  let selection = $derived(
    visibleRows.filter((r) => selectedIds.has(r.account.id)),
  )

  function toggleSelected(id: string, on: boolean) {
    const next = new Set(selectedIds)
    if (on) next.add(id)
    else next.delete(id)
    selectedIds = next
  }

  function toggleGroup(group: Group, on: boolean) {
    const next = new Set(selectedIds)
    for (const row of group.rows) {
      if (on) next.add(row.account.id)
      else next.delete(row.account.id)
    }
    selectedIds = next
  }

  function groupState(group: Group): { all: boolean; some: boolean } {
    const n = group.rows.filter((r) => selectedIds.has(r.account.id)).length
    return { all: n > 0 && n === group.rows.length, some: n > 0 }
  }

  function clearSelection() {
    selectedIds = new Set()
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !selectMode) return
    e.preventDefault()
    // Escape backs out one step at a time: it clears a selection first and leaves the mode
    // only once there is nothing selected, so a mis-click does not also close the mode you
    // were halfway through using.
    if (selectedIds.size > 0) clearSelection()
    else selectMode = false
  }

  // ── Bulk actions ──────────────────────────────────────────
  let bulkCurrency = $state('')
  let bulkBusy = $state(false)

  /** The selected rows nothing depends on — the ones a destructive bulk action may touch. */
  let hidable = $derived(selection.filter((r) => protection(r) === null))

  async function bulkPin(pinned: boolean) {
    bulkBusy = true
    try {
      await setPinned(
        selection.map((r) => r.account.id),
        pinned,
      )
    } finally {
      bulkBusy = false
    }
  }

  async function bulkHide() {
    const skipped = selection.length - hidable.length
    if (hidable.length === 0) {
      toast.show(copy.accounts.toasts.nothingToHide)
      return
    }
    bulkBusy = true
    try {
      await setHidden(
        hidable.map((r) => r.account.id),
        true,
      )
      if (skipped > 0) {
        toast.show(
          copy.accounts.toasts.hidSomeKeptOthers(hidable.length, skipped),
        )
      }
    } finally {
      bulkBusy = false
    }
  }

  async function bulkSetCurrency() {
    if (!bulkCurrency) return
    bulkBusy = true
    const targets = selection.map((r) => r.account)
    try {
      await Promise.all(
        targets.map((a) =>
          updateAccount(a.id, { defaultCurrency: bulkCurrency }),
        ),
      )
      toast.show(copy.accounts.toasts.currencySet(bulkCurrency, targets.length))
      bulkCurrency = ''
    } catch {
      toast.show(copy.accounts.toasts.currencyFailed)
    } finally {
      bulkBusy = false
    }
  }

  // Import targets exactly one account — a CSV belongs to one statement — so this hands off
  // rather than looping. The import page reads `?account=` as a pre-target.
  function importSelected() {
    const only = selection[0]
    if (!only) return
    void goto(`/import?account=${encodeURIComponent(only.account.id)}`)
  }

  // ── Creating an account ───────────────────────────────────
  // The wizard used to hang off the sidebar's per-group "+", which went with the groups. It
  // does more than insert a row — it sets up the CSV parser and the starting balance — so it
  // needed a home rather than a deletion, and accounts live here now. The select follows the
  // bulk bar's "Set currency…" idiom: the placeholder is the label, choosing is the action.
  let wizardOpen = $state(false)
  let wizardType = $state<'asset' | 'liability' | 'equity'>('asset')
  let newAccountKind = $state('')

  function startWizard(kind: string) {
    if (kind !== 'asset' && kind !== 'liability' && kind !== 'equity') return
    wizardType = kind
    wizardOpen = true
    newAccountKind = ''
  }

  async function reloadAccounts() {
    accounts = await fetchAccountBalances({ includeUnfiled: true })
    lastActivityById = new Map(
      (await fetchAccountPostingCounts()).map((c) => [
        c.accountId,
        c.lastActivity,
      ]),
    )
    refreshSidebar()
  }

  // ── Row expansion ─────────────────────────────────────────
  // One at a time: the drawer fetches an account's transactions when it opens, and a table
  // that can hold six of those open is a table that fires six requests on a stray click.
  let openRowId = $state<string | null>(null)

  function toggleRow(id: string) {
    openRowId = openRowId === id ? null : id
  }

  // ── Collapse ──────────────────────────────────────────────
  let collapsed = $state<Record<string, boolean>>({})

  function toggle(key: string) {
    collapsed[key] = !collapsed[key]
  }

  // ── Row helpers ───────────────────────────────────────────
  function typeLabel(row: Row): string {
    const resolved = row.account.resolvedType
    if (!resolved)
      return row.surface === 'unfiled'
        ? copy.accounts.rows.unfiled
        : row.surface
    return toClassifierType(resolved)
  }

  function rowTotal(row: Row) {
    return convertRows([row], activeRates, preferred)
  }

  // A currency group totals natively — every row in it is already in that one currency, so
  // the sum is exact and needs no rate. Everything else converts to the preferred currency.
  function groupTotal(group: Group) {
    const native = groupCurrency(group)
    return {
      unit: native ?? preferred,
      approx: native === null && converted,
      ...convertRows(group.rows, activeRates, native ?? preferred),
    }
  }
</script>

<svelte:head><title>{copy.accounts.page.documentTitle}</title></svelte:head>
<svelte:window onkeydown={onKeydown} />

<AddAccountWizard
  type={wizardType}
  bind:open={wizardOpen}
  onSuccess={reloadAccounts}
/>

<div class="page">
  <header class="page-head">
    <h1>{copy.accounts.page.heading}</h1>
    <TabStrip
      tabs={TABS}
      active={activeTab}
      onselect={selectTab}
      label={copy.accounts.page.tabsLabel}
      panelIdPrefix="accounts"
    />
  </header>

  {#if activeTab === 'accounts'}
    <div
      class="panel"
      id="accounts-panel-accounts"
      role="tabpanel"
      aria-labelledby="accounts-tab-accounts"
    >
      <!-- Position: the four-way split of what you have, all four derived from the
           configured root paths rather than from any per-account flag.

           Exactly one loudest element, and which one depends on the state (DESIGN.md §5).
           Caught up, that is Available — the number you opened the page for. With work
           outstanding it is the work, because every figure below it is provisional until
           that work is done, and an aggregate the app knows to be incomplete should not be
           the biggest thing on the screen. Four tiles of equal weight answered neither
           state: the eye had to pick, every time. -->
      <section class="position" aria-label={copy.accounts.position.regionLabel}>
        {#if loading}
          <div class="headline">
            <Shimmer height="2rem" />
          </div>
        {:else}
          {#if outstanding}
            <div class="outstanding">
              <Icon name="warning" size={14} />
              <p class="outstanding-text">
                {#if unbootstrapped > 0}
                  <span>
                    {copy.accounts.position.noStartingLine(unbootstrapped)}
                  </span>
                  <a class="outstanding-action" href="/catch-up">
                    {copy.accounts.position.setStartingLines}
                  </a>
                {/if}
                {#if attentionTotal > 0}
                  <span>
                    {copy.accounts.position.needsDecision(attentionTotal)}
                  </span>
                  <!-- The filter lives here rather than in the toolbar: it is the action
                       this sentence is asking for, and having it in both places would be
                       two ways to do one thing. -->
                  <button
                    type="button"
                    class="outstanding-action"
                    aria-pressed={attentionOnly}
                    onclick={() => (attentionOnly = !attentionOnly)}
                  >
                    {attentionOnly
                      ? copy.accounts.position.showEverything
                      : copy.accounts.position.showOutstanding}
                  </button>
                {/if}
              </p>
            </div>
          {/if}

          <div class="figures" class:stacked={!outstanding}>
            {#each POSITION_CARDS as card, i (card.key)}
              {@const bucket = position[card.key]}
              {@const note = conversionNote(bucket, preferred, converted)}
              {@const asOf = positionNotes?.[card.key] ?? null}
              {@const lead = i === 0 && !outstanding}
              <div class="figure" class:lead>
                <span class="position-label">
                  {copy.accounts.position[card.key]}
                </span>
                <span
                  class="position-value"
                  class:negative={!card.magnitude &&
                    !card.neutralSign &&
                    bucket.cents < 0}
                >
                  {card.magnitude
                    ? formatCentsAbs(bucket.cents)
                    : formatCents(bucket.cents)}
                  <span class="position-currency">{preferred}</span>
                </span>
                {#if note}
                  <span
                    class="position-note"
                    title={converted
                      ? copy.accounts.conversion.missingRate(
                          bucket.missing.join(', '),
                        )
                      : copy.accounts.conversion.notConverted(
                          bucket.missing.join(', '),
                        )}
                  >
                    {note}
                  </span>
                {/if}
                <!-- The as-of. A statement, not a warning: no icon, no alarm colour, and
                     the figure above keeps its weight — when everything is stale, muting
                     everything makes the page read as broken and the user stops seeing it. -->
                {#if asOf}
                  <span class="position-asof" title={asOf.detail}
                    >{asOf.text}</span
                  >
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <ControlBar>
        <SearchField
          bind:value={query}
          placeholder={copy.accounts.controls.search}
        />

        <label class="control">
          <span>{copy.accounts.controls.group}</span>
          <Select
            bind:value={grouping}
            aria-label={copy.accounts.controls.groupBy}
          >
            <option value="institution">
              {copy.accounts.controls.grouping.institution}
            </option>
            <option value="type">{copy.accounts.controls.grouping.type}</option>
            <option value="currency">
              {copy.accounts.controls.grouping.currency}
            </option>
            <option value="flat">{copy.accounts.controls.grouping.flat}</option>
          </Select>
        </label>

        <label class="control">
          <span>{copy.accounts.controls.show}</span>
          <Select
            bind:value={show}
            aria-label={copy.accounts.controls.showWhich}
          >
            <option value="active">
              {copy.accounts.controls.showing.active}
            </option>
            <option value="all">{copy.accounts.controls.showing.all}</option>
            <option value="hidden">
              {copy.accounts.controls.showing.hidden}
            </option>
          </Select>
        </label>

        {#if foreignCurrencies.length > 0}
          <ConvertToggle
            {converted}
            busy={converting}
            currency={preferred}
            offLabel={copy.accounts.conversion.showNative(preferred)}
            onclick={toggleConvert}
          />
        {/if}

        <label class="control">
          <span class="sr-only">{copy.accounts.controls.create}</span>
          <Select
            bind:value={newAccountKind}
            aria-label={copy.accounts.controls.create}
            onchange={() => startWizard(newAccountKind)}
          >
            <option value="">{copy.accounts.controls.newAccount}</option>
            <option value="asset">{copy.accounts.controls.kinds.asset}</option>
            <option value="liability">
              {copy.accounts.controls.kinds.liability}
            </option>
            <option value="equity">{copy.accounts.controls.kinds.equity}</option
            >
          </Select>
        </label>

        {#if selectMode}
          <GradientButton active onclick={toggleSelectMode}>
            {copy.accounts.controls.selectDone}
          </GradientButton>
        {:else}
          <GradientButton
            tooltip={copy.accounts.controls.selectHint}
            onclick={toggleSelectMode}
          >
            <Icon name="edit-txn" />
            {copy.accounts.controls.select}
          </GradientButton>
        {/if}

        <span class="count trailing">
          {copy.accounts.controls.count(visibleRows.length)}
        </span>
      </ControlBar>

      {#if convertError}
        <p class="message error">{convertError}</p>
      {/if}

      {#if error}
        <p class="message error">{error}</p>
      {:else if loading}
        <div class="loading-block">
          {#each { length: 5 } as _}
            <Shimmer height="1.5rem" />
          {/each}
        </div>
      {:else if groups.length === 0}
        <p class="message">
          {query.trim()
            ? copy.accounts.search.noMatch(query.trim())
            : copy.accounts.search.empty}
        </p>
      {:else}
        <Sheet {columns} caption={copy.accounts.columns.caption}>
          {#each groups as group (group.key)}
            {@const total = groupTotal(group)}
            <SheetBand
              label={group.label}
              count={group.rows.length}
              total={`${total.approx ? '≈ ' : ''}${formatCents(total.cents)}`}
              unit={total.unit}
              note={conversionNote(total, total.unit, converted) ?? undefined}
              noteTitle={converted
                ? copy.accounts.conversion.missingRate(total.missing.join(', '))
                : copy.accounts.conversion.notConverted(
                    total.missing.join(', '),
                  )}
              collapsed={collapsed[group.key] ?? false}
              ontoggle={() => toggle(group.key)}
            >
              {#snippet trailing()}
                {#if selectMode}
                  {@const state = groupState(group)}
                  <Checkbox
                    checked={state.all}
                    ariaLabel={copy.accounts.groups.selectAll(group.label)}
                    size={14}
                    onchange={(on) => toggleGroup(group, on)}
                  />
                {/if}
              {/snippet}
            </SheetBand>

            {#if !(collapsed[group.key] ?? false)}
              {#each group.rows as row (row.account.id)}
                {@const rowConverted = rowTotal(row)}
                {@const guard = protection(row)}
                {@const pinned = pinnedIds.has(row.account.id)}
                {@const hidden = hiddenIds.has(row.account.id)}
                {@const open = openRowId === row.account.id}
                {@const selected = selectedIds.has(row.account.id)}
                <tr class:selected class:open>
                  <td class="account">
                    <div class="name-cell">
                      {#if selectMode}
                        <Checkbox
                          checked={selected}
                          ariaLabel={copy.accounts.rows.select(row.displayName)}
                          size={14}
                          onchange={(on) => toggleSelected(row.account.id, on)}
                        />
                      {/if}
                      <span class="name">
                        <a
                          class="account-link"
                          href="/account/{row.account.id}"
                        >
                          {row.displayName}
                        </a>
                        {#if row.account.name}
                          <span class="sub">{row.account.path}</span>
                        {/if}
                      </span>
                    </div>
                  </td>
                  <td><Chip size="xs">{typeLabel(row)}</Chip></td>
                  <td class="num">
                    {#if row.balances.length === 0}
                      <span class="muted">—</span>
                    {:else}
                      {#each row.balances as b (b.currency)}
                        {@const cents = toCents(b.amount)}
                        <span class="native">
                          <CurrencyPill code={b.currency} size="xs" />
                          {cents === null ? b.amount : formatCents(cents)}
                        </span>
                      {/each}
                    {/if}
                  </td>
                  {#if converted}
                    <td class="num">
                      {#if rowConverted.missing.length > 0}
                        <span
                          class="muted"
                          title={copy.accounts.conversion.noRate}>—</span
                        >
                      {:else if row.balances.length === 0}
                        <span class="muted">—</span>
                      {:else}
                        {formatCents(rowConverted.cents)}
                      {/if}
                    </td>
                  {/if}
                  <td>
                    {#if row.lastActivity}
                      {row.lastActivity}
                      {#if row.idleDays !== null && row.idleDays > STALE_AFTER_DAYS}
                        <span class="sub stale">
                          {copy.accounts.rows.idle(row.idleDays)}
                        </span>
                      {/if}
                    {:else}
                      <span class="muted">{copy.accounts.rows.never}</span>
                    {/if}
                  </td>
                  <td>
                    <AccountFlags
                      accountId={row.account.id}
                      {settings}
                      protection={guard}
                    >
                      {#snippet lead()}
                        {@const needs = attentionFor(row.account.id) ?? 0}
                        {#if needs > 0}
                          <span title={attentionChip(needs).label}>
                            <Chip size="xs" icon="warning">{needs}</Chip>
                          </span>
                        {/if}
                      {/snippet}
                      {#if pinned}
                        <Chip size="xs" icon="pin">
                          {copy.accounts.rows.pinned}
                        </Chip>
                      {/if}
                      {#if hidden}
                        <Chip size="xs" icon="eye-off">
                          {copy.accounts.rows.hidden}
                        </Chip>
                      {/if}
                    </AccountFlags>
                  </td>
                  <td class="actions">
                    <GradientButton
                      quiet
                      square
                      aria-label={open
                        ? copy.accounts.rows.hideEntries(row.displayName)
                        : copy.accounts.rows.showEntries(row.displayName)}
                      aria-expanded={open}
                      tooltip={open
                        ? copy.case.dialog.close
                        : copy.accounts.rows.entriesHint}
                      onclick={() => toggleRow(row.account.id)}
                    >
                      <Icon
                        name={open ? 'chevron-up-filled' : 'chevron-down-line'}
                        size={13}
                      />
                    </GradientButton>
                    <GradientButton
                      quiet
                      square
                      active={pinned}
                      aria-label={pinned
                        ? copy.accounts.rows.unpin(row.displayName)
                        : copy.accounts.rows.pin(row.displayName)}
                      tooltip={pinned
                        ? copy.accounts.rows.unpinHint
                        : copy.accounts.rows.pinHint}
                      onclick={() => setPinned([row.account.id], !pinned)}
                    >
                      <Icon name="pin" size={13} />
                    </GradientButton>
                    <GradientButton
                      quiet
                      square
                      active={hidden}
                      disabled={guard !== null && !hidden}
                      aria-label={hidden
                        ? copy.accounts.rows.unhide(row.displayName)
                        : copy.accounts.rows.hide(row.displayName)}
                      tooltip={guard !== null && !hidden
                        ? protectionMessage(guard)
                        : hidden
                          ? copy.accounts.rows.unhideHint
                          : copy.accounts.rows.hideHint}
                      onclick={() => setHidden([row.account.id], !hidden)}
                    >
                      <Icon name={hidden ? 'eye' : 'eye-off'} size={13} />
                    </GradientButton>
                  </td>
                </tr>
                {#if open}
                  <!-- A second row rather than a nested table: a <td> cannot contain a
                       row, and colspan is what keeps the drawer inside the grid. -->
                  <tr class="spanning">
                    <td colspan={columns.length}>
                      <AccountDrawer
                        match={{ kind: 'account', accountId: row.account.id }}
                        path={row.account.path}
                        accountId={row.account.id}
                        root={rootFor(row.surface, roots)}
                        attention={attentionFor(row.account.id)}
                        canImport
                      />
                    </td>
                  </tr>
                {/if}
              {/each}
            {/if}
          {/each}
        </Sheet>
      {/if}

      <!-- Bulk actions curate in one gesture rather than six: pinning the Wise accounts one
           at a time is what would kill the pinned sidebar before it started. The tray is
           last in the scrolled content and floats over it — see SelectionTray. -->
      {#if selection.length > 0}
        <SelectionTray count={selection.length} onclear={clearSelection}>
          <GradientButton
            size="lg"
            disabled={bulkBusy}
            onclick={() => bulkPin(true)}
          >
            {copy.accounts.bulk.pinAll}
          </GradientButton>
          <GradientButton
            size="lg"
            disabled={bulkBusy}
            onclick={() => bulkPin(false)}
          >
            {copy.accounts.bulk.unpinAll}
          </GradientButton>
          <GradientButton
            size="lg"
            disabled={bulkBusy || hidable.length === 0}
            tooltip={hidable.length === 0
              ? copy.accounts.bulk.allInUse
              : hidable.length < selection.length
                ? copy.accounts.bulk.someInUse(
                    selection.length - hidable.length,
                  )
                : undefined}
            onclick={bulkHide}
          >
            {copy.accounts.bulk.hideAll}
          </GradientButton>

          <label class="bulk-currency">
            <span class="sr-only">{copy.accounts.bulk.currency}</span>
            <Select
              bind:value={bulkCurrency}
              disabled={bulkBusy}
              aria-label={copy.accounts.bulk.currency}
            >
              <option value="">{copy.accounts.bulk.setCurrency}</option>
              {#each SUPPORTED_CURRENCIES as code (code)}
                <option value={code}>{code}</option>
              {/each}
            </Select>
          </label>
          {#if bulkCurrency}
            <GradientButton
              size="lg"
              disabled={bulkBusy}
              onclick={bulkSetCurrency}
            >
              {copy.accounts.bulk.apply(bulkCurrency)}
            </GradientButton>
          {/if}

          <GradientButton
            size="lg"
            disabled={bulkBusy || selection.length !== 1}
            tooltip={selection.length === 1
              ? copy.accounts.bulk.importOne
              : copy.accounts.bulk.importMany}
            onclick={importSelected}
          >
            {copy.accounts.bulk.import}
          </GradientButton>
        </SelectionTray>
      {/if}
    </div>
  {:else}
    <div
      class="panel"
      id="accounts-panel-categories"
      role="tabpanel"
      aria-labelledby="accounts-tab-categories"
    >
      <CategoriesTab {settings} />
    </div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    padding: var(--sp-lg);
    min-height: 100%;
  }

  .page-head {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
  }

  h1 {
    font-family: var(--font-serif);
    font-size: var(--text-title);
    font-weight: var(--weight-bold);
    margin: 0;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
  }

  /* --- Position header --- *
     Two states, one loudest element in each. Caught up, that is the Available figure, set
     large and leading; with work outstanding it is the outstanding line, and all four
     figures step down to the same secondary weight because every one of them is provisional
     until the work is done. */
  .position {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
  }

  .outstanding {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-warning-light);
    border: 1px solid color-mix(in srgb, var(--color-warning) 35%, transparent);
    border-radius: var(--radius-md);
    color: var(--color-warning);
  }

  .outstanding-text {
    margin: 0;
    font-size: var(--text-body);
    line-height: var(--leading-snug);
    text-wrap: pretty;
  }

  /* The action reads as the link it is, in the same ink as the sentence around it: this
     band is already the loudest thing on the screen, and spending the accent inside it as
     well would be spending it twice. */
  .outstanding-action {
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .outstanding-action:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .figures {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--sp-sm);
  }

  /* Caught up: the lead figure takes a column and a half and the other three share the
     rest, which is what makes it read as the answer rather than as the first of four. */
  .figures.stacked {
    grid-template-columns: 1.6fr 1fr 1fr 1fr;
  }

  .figure {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4xs);
    min-width: 0;
    padding: var(--sp-sm) var(--sp-md);
    background: var(--color-window);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-lg);
    box-shadow: var(--card-shadow);
  }

  .position-label {
    font-size: var(--text-dense);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .position-value {
    font-family: var(--font-mono);
    font-size: var(--text-amount);
    font-weight: var(--weight-bold);
    white-space: nowrap;
  }

  .figure.lead .position-value {
    font-size: var(--text-title);
    line-height: var(--leading-tight);
  }

  .position-value.negative {
    color: var(--color-amount-negative);
  }

  .position-currency {
    font-size: var(--text-dense);
    color: var(--color-text-muted);
    font-weight: var(--weight-normal);
  }

  .figure.lead .position-currency {
    font-size: var(--text-body);
  }

  .position-note {
    font-size: var(--text-dense);
    color: var(--color-text-muted);
    font-style: italic;
  }

  /* The as-of, deliberately not styled like the caveat above it: upright, because it is a
     statement about the figure rather than an aside about currencies. Muted and small so the
     figure keeps the weight — the date does the honesty work, not a colour change. */
  .position-asof {
    font-size: var(--text-dense);
    color: var(--color-text-muted);
    line-height: var(--leading-snug);
    /* The line runs to two clauses when an account has no starting line, and a narrow tile
       breaks it. `pretty` keeps the last line from being a single orphaned word. */
    text-wrap: pretty;
  }

  .headline {
    padding: var(--sp-sm) var(--sp-md);
  }

  @media (max-width: 900px) {
    .figures,
    .figures.stacked {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  /* --- Toolbar --- */
  .count {
    font-size: var(--text-dense);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  /* --- Bulk bar --- */
  .bulk-currency {
    display: flex;
    align-items: center;
  }

  .native {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp-3xs);
  }

  /* The checkbox shares the account cell rather than owning a column of its own, so it
     costs nothing on the visits — most of them — that never enter select mode. */
  .name-cell {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    min-width: 0;
  }

  .name {
    min-width: 0;
  }

  .account-link {
    color: var(--color-text);
    text-decoration: none;
  }

  .account-link:hover {
    text-decoration: underline;
  }

  .sub {
    display: block;
    font-size: var(--text-dense);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stale {
    color: var(--color-warning);
  }

  /* --- Row state --- *
     `tbody` is not in this component's markup — it belongs to Sheet — so these selectors
     start at the row, which is. */
  tr.open td {
    background: var(--color-window-raised);
  }

  tr.selected td {
    background: var(--color-accent-chip-bg);
  }

  /* --- Messages --- */
  .message {
    padding: var(--sp-lg);
    color: var(--color-text-muted);
    font-size: var(--text-body);
  }

  .message.error {
    color: var(--color-danger);
  }

  .loading-block {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    padding: var(--sp-sm);
  }
</style>
