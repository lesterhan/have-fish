<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import Card from '$lib/components/ui/Card.svelte'
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
  import SectionCard from '$lib/components/accounts/SectionCard.svelte'
  import {
    fetchAccountBalances,
    fetchAccountPostingCounts,
    fetchCoverageStatus,
    fetchFxRateAsOf,
    toClassifierType,
    updateAccount,
  } from '$lib/api'
  import type { AccountBalance, AccountCoverageStatus, UserSettings } from '$lib/api'
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
    { id: 'accounts', label: 'Accounts' },
    { id: 'categories', label: 'Categories' },
  ]

  // "Available", not "Cash": unconverted, the figure is the preferred-currency balance and
  // nothing else, and "Cash" invites the question "so where is my USD?" that the card is not
  // answering. Owing reads as a magnitude under its own label rather than a signed figure —
  // a card that owes 3,759 is not an error, and a minus sign there is an alarm that never
  // stops going off.
  const POSITION_CARDS: {
    key: PositionBucket
    label: string
    magnitude?: boolean
  }[] = [
    { key: 'cash', label: 'Available' },
    { key: 'investments', label: 'Investments' },
    { key: 'owed', label: 'Owed to you' },
    { key: 'owing', label: 'You owe', magnitude: true },
  ]

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
      error = 'Could not load accounts.'
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
        convertError = `No exchange rates available right now — still showing ${preferred} balances.`
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
  let positionRows = $derived(allRows.filter((r) => !hiddenIds.has(r.account.id)))

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
      cash: completenessNote(completeness(coverageFor(coverageById, ids.cash)), today),
      investments: completenessNote(
        completeness(coverageFor(coverageById, ids.investments)),
        today,
      ),
      owed: completenessNote(completeness(coverageFor(coverageById, ids.owed)), today),
      owing: completenessNote(completeness(coverageFor(coverageById, ids.owing)), today),
    }
  })

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
      toast.show('Could not save that — nothing changed.')
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
      toast.show(
        `Hidden — switch Show to All or Hidden to see ${ids.length === 1 ? 'it' : 'them'}.`,
      )
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
  let selectedIds = $state<Set<string>>(new Set())

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
    if (e.key === 'Escape' && selectedIds.size > 0) {
      e.preventDefault()
      clearSelection()
    }
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
      toast.show('Nothing to hide — every account selected is in use.')
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
          `Hid ${hidable.length}; kept ${skipped} that ${skipped === 1 ? 'is' : 'are'} in use.`,
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
      toast.show(
        `Default currency set to ${bulkCurrency} on ${targets.length} account${targets.length === 1 ? '' : 's'}.`,
      )
      bulkCurrency = ''
    } catch {
      toast.show('Could not set the currency on every account.')
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
    if (!resolved) return row.surface === 'unfiled' ? 'unfiled' : row.surface
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

<svelte:head><title>Accounts · have-fish</title></svelte:head>
<svelte:window onkeydown={onKeydown} />

<AddAccountWizard
  type={wizardType}
  bind:open={wizardOpen}
  onSuccess={reloadAccounts}
/>

<div class="page">
  <header class="page-head">
    <h1>Accounts</h1>
    <TabStrip
      tabs={TABS}
      active={activeTab}
      onselect={selectTab}
      label="Accounts page sections"
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
           configured root paths rather than from any per-account flag. -->
      <div class="position">
        {#each POSITION_CARDS as card (card.key)}
          {@const bucket = position[card.key]}
          <Card class="position-card">
            <span class="position-label">{card.label}</span>
            {#if loading}
              <Shimmer height="1.25rem" />
            {:else}
              <span
                class="position-value"
                class:negative={!card.magnitude && bucket.cents < 0}
              >
                {card.magnitude
                  ? formatCentsAbs(bucket.cents)
                  : formatCents(bucket.cents)}
                <span class="position-currency">{preferred}</span>
              </span>
              {@const note = conversionNote(bucket, preferred, converted)}
              {#if note}
                <span
                  class="position-note"
                  title={converted
                    ? `Balances in ${bucket.missing.join(', ')} are not included — no exchange rate available`
                    : `Also holds ${bucket.missing.join(', ')} — convert to fold them in`}
                >
                  {note}
                </span>
              {/if}
              <!-- The as-of. A statement, not a warning: no icon, no alarm colour, and the
                   figure above keeps its weight — when everything is stale, muting everything
                   makes the page read as broken and the user stops seeing it. -->
              {@const asOf = positionNotes?.[card.key] ?? null}
              {#if asOf}
                <span class="position-asof" title={asOf.detail}>{asOf.text}</span>
              {/if}
            {/if}
          </Card>
        {/each}
      </div>

      <ControlBar>
        <SearchField bind:value={query} placeholder="Search accounts" />

        <label class="control">
          <span>Group</span>
          <Select bind:value={grouping} aria-label="Group accounts by">
            <option value="institution">Institution</option>
            <option value="type">Type</option>
            <option value="currency">Currency</option>
            <option value="flat">Flat</option>
          </Select>
        </label>

        <label class="control">
          <span>Show</span>
          <Select bind:value={show} aria-label="Which accounts to show">
            <option value="active">Active</option>
            <option value="all">All</option>
            <option value="hidden">Hidden</option>
          </Select>
        </label>

        {#if needAttention.length > 0}
          {@const chip = attentionChip(attentionTotal)}
          <GradientButton
            active={attentionOnly}
            attention={!attentionOnly}
            tooltip={attentionOnly
              ? 'Show every account again'
              : `Scope the table to the ${needAttention.length === 1 ? 'account' : 'accounts'} with something unfinished`}
            onclick={() => (attentionOnly = !attentionOnly)}
          >
            {chip.label}
          </GradientButton>
        {/if}

        {#if foreignCurrencies.length > 0}
          <ConvertToggle
            {converted}
            busy={converting}
            currency={preferred}
            offLabel={`Show ${preferred} only`}
            onclick={toggleConvert}
          />
        {/if}

        <label class="control">
          <span class="sr-only">Create an account</span>
          <Select
            bind:value={newAccountKind}
            aria-label="Create an account"
            onchange={() => startWizard(newAccountKind)}
          >
            <option value="">New account…</option>
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
            <option value="equity">Equity</option>
          </Select>
        </label>

        <span class="count trailing">
          {visibleRows.length}
          {visibleRows.length === 1 ? 'account' : 'accounts'}
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
            ? `Nothing matches “${query.trim()}”.`
            : 'No accounts here yet.'}
        </p>
      {:else}
        {#each groups as group (group.key)}
          {@const total = groupTotal(group)}
          {@const state = groupState(group)}
          <SectionCard
            label={group.label}
            count={group.rows.length}
            total={`${total.approx ? '≈ ' : ''}${formatCents(total.cents)}`}
            unit={total.unit}
            note={conversionNote(total, total.unit, converted) ?? undefined}
            noteTitle={converted
              ? `Balances in ${total.missing.join(', ')} are not included — no exchange rate available`
              : `Also holds ${total.missing.join(', ')} — convert to fold them in`}
            collapsed={collapsed[group.key] ?? false}
            ontoggle={() => toggle(group.key)}
          >
            {#snippet lead()}
              <Checkbox
                checked={state.all}
                ariaLabel={`Select every account in ${group.label}`}
                size={14}
                onchange={(on) => toggleGroup(group, on)}
              />
            {/snippet}
            <table>
              <thead>
                <tr>
                  <th class="pick"><span class="sr-only">Select</span></th>
                  <th>Account</th>
                  <th>Type</th>
                  <th class="num">Balance</th>
                  {#if converted}
                    <th class="num">≈ {preferred}</th>
                  {/if}
                  <th>Last activity</th>
                  <th>Flags</th>
                  <th class="actions"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {#each group.rows as row (row.account.id)}
                  {@const rowConverted = rowTotal(row)}
                  {@const guard = protection(row)}
                  {@const pinned = pinnedIds.has(row.account.id)}
                  {@const hidden = hiddenIds.has(row.account.id)}
                  {@const open = openRowId === row.account.id}
                  <tr
                    class:selected={selectedIds.has(row.account.id)}
                    class:open
                  >
                    <td class="pick">
                      <Checkbox
                        checked={selectedIds.has(row.account.id)}
                        ariaLabel={`Select ${row.displayName}`}
                        size={14}
                        onchange={(on) => toggleSelected(row.account.id, on)}
                      />
                    </td>
                    <td>
                      <a class="account-link" href="/account/{row.account.id}">
                        {row.displayName}
                      </a>
                      {#if row.account.name}
                        <span class="sub">{row.account.path}</span>
                      {/if}
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
                          <span class="muted" title="No exchange rate available"
                            >—</span
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
                          <span class="sub stale">stale {row.idleDays}d</span>
                        {/if}
                      {:else}
                        <span class="muted">never</span>
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
                          <Chip size="xs" icon="pin">pinned</Chip>
                        {/if}
                        {#if hidden}
                          <Chip size="xs" icon="eye-off">hidden</Chip>
                        {/if}
                      </AccountFlags>
                    </td>
                    <td class="actions">
                      <GradientButton
                        quiet
                        square
                        aria-label={open
                          ? `Hide recent entries for ${row.displayName}`
                          : `Show recent entries for ${row.displayName}`}
                        aria-expanded={open}
                        tooltip={open
                          ? 'Close'
                          : 'Recent entries and what is unfinished'}
                        onclick={() => toggleRow(row.account.id)}
                      >
                        <Icon
                          name={open
                            ? 'chevron-up-filled'
                            : 'chevron-down-line'}
                          size={13}
                        />
                      </GradientButton>
                      <GradientButton
                        quiet
                        square
                        active={pinned}
                        aria-label={pinned
                          ? `Unpin ${row.displayName}`
                          : `Pin ${row.displayName}`}
                        tooltip={pinned
                          ? 'Unpin from sidebar'
                          : 'Pin to sidebar'}
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
                          ? `Unhide ${row.displayName}`
                          : `Hide ${row.displayName}`}
                        tooltip={guard !== null && !hidden
                          ? protectionMessage(guard)
                          : hidden
                            ? 'Unhide'
                            : 'Hide'}
                        onclick={() => setHidden([row.account.id], !hidden)}
                      >
                        <Icon name={hidden ? 'eye' : 'eye-off'} size={13} />
                      </GradientButton>
                    </td>
                  </tr>
                  {#if open}
                    <!-- A second row rather than a nested table: a <td> cannot contain a
                         row, and colspan is what keeps the drawer inside the grid. -->
                    <tr class="drawer-row">
                      <td colspan={converted ? 8 : 7}>
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
              </tbody>
            </table>
          </SectionCard>
        {/each}
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
            Pin all
          </GradientButton>
          <GradientButton
            size="lg"
            disabled={bulkBusy}
            onclick={() => bulkPin(false)}
          >
            Unpin all
          </GradientButton>
          <GradientButton
            size="lg"
            disabled={bulkBusy || hidable.length === 0}
            tooltip={hidable.length === 0
              ? 'Every account selected is in use'
              : hidable.length < selection.length
                ? `${selection.length - hidable.length} in use and will be kept`
                : undefined}
            onclick={bulkHide}
          >
            Hide all
          </GradientButton>

          <label class="bulk-currency">
            <span class="sr-only"
              >Default currency for the selected accounts</span
            >
            <Select
              bind:value={bulkCurrency}
              disabled={bulkBusy}
              aria-label="Default currency for the selected accounts"
            >
              <option value="">Set currency…</option>
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
              Apply {bulkCurrency}
            </GradientButton>
          {/if}

          <GradientButton
            size="lg"
            disabled={bulkBusy || selection.length !== 1}
            tooltip={selection.length === 1
              ? 'Open Import targeting this account'
              : 'Import takes one account — a statement belongs to one'}
            onclick={importSelected}
          >
            Import
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
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    margin: 0;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
  }

  /* --- Position row --- */
  .position {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--sp-sm);
  }

  @media (max-width: 700px) {
    .position {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  :global(.card.position-card) {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--sp-sm) var(--sp-md);
    min-width: 0;
  }

  .position-label {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .position-value {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }

  .position-value.negative {
    color: var(--color-amount-negative);
  }

  .position-currency {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-weight: var(--weight-normal);
  }

  .position-note {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-style: italic;
  }

  /* The as-of, deliberately not styled like the caveat above it: upright, because it is a
     statement about the figure rather than an aside about currencies. Muted and small so the
     figure keeps the weight — the date does the honesty work, not a colour change. */
  .position-asof {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: 1.3;
    /* The line runs to two clauses when an account has no starting line, and a narrow tile
       breaks it. `pretty` keeps the last line from being a single orphaned word. */
    text-wrap: pretty;
  }

  /* --- Toolbar --- */
  .count {
    font-size: var(--text-xs);
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
    gap: 4px;
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
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  .stale {
    color: var(--color-amount-negative);
  }

  /* --- Row expansion --- *
     The drawer supplies its own padding and left rule, so the cell gets out of the way. */
  tbody tr.drawer-row td {
    padding: 0;
  }

  tbody tr.open td {
    background: var(--color-window-raised);
  }

  /* --- Selection --- *
     The rest of the table's column semantics (`.num`, `.actions`, `.muted`) come from
     SectionCard, which is what keeps the two tabs looking like one page. */
  th.pick,
  td.pick {
    width: 1%;
    padding-right: 0;
  }

  tbody tr.selected td {
    background: var(--color-accent-light);
  }

  /* --- Messages --- */
  .message {
    padding: var(--sp-lg);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
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
