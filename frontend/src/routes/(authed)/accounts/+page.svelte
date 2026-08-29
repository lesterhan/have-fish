<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import Card from '$lib/components/ui/Card.svelte'
  import Checkbox from '$lib/components/ui/Checkbox.svelte'
  import Chip from '$lib/components/ui/Chip.svelte'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import ConvertToggle from '$lib/components/ui/ConvertToggle.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Select from '$lib/components/ui/Select.svelte'
  import Shimmer from '$lib/components/ui/Shimmer.svelte'
  import TabStrip, { type TabItem } from '$lib/components/ui/TabStrip.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import {
    fetchAccountBalances,
    fetchAccountPostingCounts,
    fetchFxRateAsOf,
    toClassifierType,
    updateAccount,
  } from '$lib/api'
  import type { AccountBalance, UserSettings } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import { toast } from '$lib/toast.svelte'
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
    rootsFrom,
    type PositionBucket,
  } from '$lib/components/accounts/accountPaths'
  import {
    ROLE_DESCRIPTION,
    ROLE_LABEL,
    protectionFor,
    protectionMessage,
    rolesOf,
    type Protection,
  } from '$lib/components/accounts/accountRoles'
  import {
    STALE_AFTER_DAYS,
    buildRows,
    convertRows,
    currenciesNeedingRates,
    groupCurrency,
    groupRows,
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
  const POSITION_CARDS: { key: PositionBucket; label: string; magnitude?: boolean }[] = [
    { key: 'cash', label: 'Available' },
    { key: 'investments', label: 'Investments' },
    { key: 'owed', label: 'Owed to you' },
    { key: 'owing', label: 'You owe', magnitude: true },
  ]

  function tabFromUrl(url: URL): string {
    const t = url.searchParams.get('tab')
    return TABS.some((x) => x.id === t) ? t! : 'accounts'
  }

  let activeTab = $state(tabFromUrl(page.url))

  // Two guarded effects rather than one: the first follows browser back/forward, the second
  // records a click. Each is a no-op unless the two disagree, so they settle immediately.
  $effect(() => {
    const fromUrl = tabFromUrl(page.url)
    if (fromUrl !== activeTab) activeTab = fromUrl
  })

  $effect(() => {
    if (tabFromUrl(page.url) === activeTab) return
    const url = new URL(page.url)
    url.searchParams.set('tab', activeTab)
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true })
  })

  // ── Data ──────────────────────────────────────────────────
  let accounts = $state<AccountBalance[]>([])
  let lastActivityById = $state<Map<string, string | null>>(new Map())
  let settings = $state<UserSettings | null>(null)
  let rates = $state<Rates>(new Map())
  let loading = $state(true)
  let error = $state<string | null>(null)

  const today = toISODate(new Date())

  onMount(async () => {
    try {
      const [balances, counts, loaded] = await Promise.all([
        fetchAccountBalances({ includeUnfiled: true }),
        fetchAccountPostingCounts(),
        settingsStore.load(),
      ])
      accounts = balances
      lastActivityById = new Map(
        counts.map((c) => [c.accountId, c.lastActivity]),
      )
      settings = loaded
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

  // ── Controls ──────────────────────────────────────────────
  let query = $state('')
  let grouping = $state<Grouping>('institution')
  let show = $state<'active' | 'all' | 'hidden'>('active')

  let shownRows = $derived(
    allRows.filter((r) => {
      const hidden = hiddenIds.has(r.account.id)
      return show === 'all' ? true : show === 'hidden' ? hidden : !hidden
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
    matchedIds ? shownRows.filter((r) => matchedIds.has(r.account.id)) : shownRows,
  )

  let groups = $derived(groupRows(visibleRows, grouping))

  // The position row describes the money you track, so it is computed over your active
  // accounts and does not move as you search, regroup, or peek at hidden rows.
  let position = $derived(
    positionTotals(
      allRows.filter((r) => !hiddenIds.has(r.account.id)),
      roots,
      activeRates,
      preferred,
    ),
  )

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

  function withId(list: readonly string[], id: string, present: boolean): string[] {
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
      toast.show(`Hidden — switch Show to All or Hidden to see ${ids.length === 1 ? 'it' : 'them'}.`)
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
      await setPinned(selection.map((r) => r.account.id), pinned)
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
      await setHidden(hidable.map((r) => r.account.id), true)
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
        targets.map((a) => updateAccount(a.id, { defaultCurrency: bulkCurrency })),
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

<div class="page">
  <header class="page-head">
    <h1>Accounts</h1>
    <TabStrip
      tabs={TABS}
      bind:active={activeTab}
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
            {/if}
          </Card>
        {/each}
      </div>

      <div class="toolbar">
        <label class="search">
          <Icon name="search" size={12} />
          <TextInput
            bind:value={query}
            placeholder="Search accounts"
            aria-label="Search accounts"
          />
        </label>

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

        {#if foreignCurrencies.length > 0}
          <ConvertToggle
            {converted}
            busy={converting}
            currency={preferred}
            offLabel={`Show ${preferred} only`}
            onclick={toggleConvert}
          />
        {/if}

        <span class="count">
          {visibleRows.length}
          {visibleRows.length === 1 ? 'account' : 'accounts'}
        </span>
      </div>

      {#if convertError}
        <p class="message error">{convertError}</p>
      {/if}

      <!-- The bulk bar exists so curating is one gesture rather than six: pinning the Wise
           accounts one at a time is what would kill the pinned sidebar before it started. -->
      {#if selection.length > 0}
        <Card class="bulk-bar">
          <span class="bulk-count">
            {selection.length} selected
          </span>
          <GradientButton disabled={bulkBusy} onclick={() => bulkPin(true)}>
            Pin all
          </GradientButton>
          <GradientButton disabled={bulkBusy} onclick={() => bulkPin(false)}>
            Unpin all
          </GradientButton>
          <GradientButton
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
            <span class="sr-only">Default currency for the selected accounts</span>
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
            <GradientButton disabled={bulkBusy} onclick={bulkSetCurrency}>
              Apply {bulkCurrency}
            </GradientButton>
          {/if}

          <GradientButton
            disabled={bulkBusy || selection.length !== 1}
            tooltip={selection.length === 1
              ? 'Open Import targeting this account'
              : 'Import takes one account — a statement belongs to one'}
            onclick={importSelected}
          >
            Import
          </GradientButton>

          <button class="bulk-clear" type="button" onclick={clearSelection}>
            Clear <span class="key">Esc</span>
          </button>
        </Card>
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
          {@const groupNote = conversionNote(total, total.unit, converted)}
          <Card class="group-card">
            {@const state = groupState(group)}
            <div class="group-header">
              <!-- Outside the collapse button: nesting a checkbox inside a button is invalid,
                   and selecting a group should not also fold it away. -->
              <Checkbox
                checked={state.all}
                ariaLabel={`Select every account in ${group.label}`}
                size={14}
                onchange={(on) => toggleGroup(group, on)}
              />
              <button
                type="button"
                class="group-toggle"
                class:some={state.some && !state.all}
                aria-expanded={!collapsed[group.key]}
                onclick={() => toggle(group.key)}
              >
              <img
                src="/icons/chevron-right-filled.svg"
                alt=""
                aria-hidden="true"
                width="12"
                height="12"
                class="chevron"
                class:open={!collapsed[group.key]}
              />
              <span class="group-label">{group.label}</span>
              <span class="group-count">{group.rows.length}</span>
              <span class="group-total">
                {total.approx ? '≈ ' : ''}{formatCents(total.cents)}
                <span class="unit">{total.unit}</span>
              </span>
              {#if groupNote}
                <span
                  class="group-note"
                  title={converted
                    ? `Balances in ${total.missing.join(', ')} are not included — no exchange rate available`
                    : `Also holds ${total.missing.join(', ')} — convert to fold them in`}
                >
                  {groupNote}
                </span>
              {/if}
              </button>
            </div>

            {#if !collapsed[group.key]}
              <div class="table-wrap">
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
                      <tr class:selected={selectedIds.has(row.account.id)}>
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
                              <span class="muted" title="No exchange rate available">—</span>
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
                          <div class="flags">
                          {#each rolesOf(row.account.id, settings) as role (role)}
                            <span title={ROLE_DESCRIPTION[role]}>
                              <Chip size="xs" tone="accent">{ROLE_LABEL[role]}</Chip>
                            </span>
                          {/each}
                          {#if guard?.kind === 'system'}
                            <span title={protectionMessage(guard)}>
                              <Chip size="xs" icon="lock">managed</Chip>
                            </span>
                          {/if}
                          {#if pinned}
                            <Chip size="xs" icon="pin">pinned</Chip>
                          {/if}
                          {#if hidden}
                            <Chip size="xs" icon="eye-off">hidden</Chip>
                          {/if}
                          </div>
                        </td>
                        <td class="actions">
                          <GradientButton
                            quiet
                            square
                            active={pinned}
                            aria-label={pinned
                              ? `Unpin ${row.displayName}`
                              : `Pin ${row.displayName}`}
                            tooltip={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
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
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </Card>
        {/each}
      {/if}
    </div>
  {:else}
    <div
      class="panel"
      id="accounts-panel-categories"
      role="tabpanel"
      aria-labelledby="accounts-tab-categories"
    >
      <Card class="group-card">
        <div class="placeholder">
          <p>Categories move here next.</p>
          <p class="sub">
            Until then they live in <a href="/accounts/manage">Manage accounts</a>.
          </p>
        </div>
      </Card>
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

  .unit {
    font-size: var(--text-xs);
    color: inherit;
    opacity: 0.65;
    font-weight: var(--weight-normal);
  }

  .position-note {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-style: italic;
  }

  .group-note {
    font-size: var(--text-xs);
    color: inherit;
    opacity: 0.75;
    font-style: italic;
  }

  /* --- Toolbar --- */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    flex-wrap: wrap;
  }

  .search {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    color: var(--color-text-muted);
  }

  .control {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .count {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  /* --- Bulk bar --- */
  :global(.card.bulk-bar) {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    flex-wrap: wrap;
    padding: var(--sp-sm) var(--sp-md);
    background: var(--color-accent-light);
    border-color: var(--color-accent-mid);
  }

  .bulk-count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }

  .bulk-currency {
    display: flex;
    align-items: center;
  }

  .bulk-clear {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-xs);
    background: none;
    border: none;
    padding: 0;
    color: var(--color-text-muted);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .bulk-clear:hover {
    color: var(--color-text);
    text-decoration: underline;
  }

  .key {
    font-family: var(--font-mono);
    font-size: 9px;
    padding: 1px 4px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-window);
  }

  /* --- Groups --- */
  :global(.card.group-card) {
    overflow: hidden;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-section-bar-bg, var(--color-window));
    color: var(--color-section-bar-fg, var(--color-text));
    border-bottom: 1px solid var(--color-rule);
  }

  .group-toggle {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    flex: 1;
    min-width: 0;
    padding: 0;
    background: none;
    border: none;
    color: inherit;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    transition: filter var(--duration-fast) var(--ease);
  }

  .group-toggle:hover {
    filter: brightness(1.25);
  }

  .group-toggle:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 2px;
  }

  .chevron {
    transition: transform var(--duration-fast) var(--ease);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .group-label {
    font-weight: var(--weight-semibold);
  }

  /* The section bar is dark in both themes, so anything secondary on it dims by opacity
     rather than by --color-text-muted, which is a dark grey and disappears against it. */
  .group-count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: inherit;
    opacity: 0.65;
  }

  .group-total {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  /* --- Table --- */
  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  th {
    padding: var(--sp-xs) var(--sp-sm);
    text-align: left;
    font-weight: var(--weight-semibold);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    border-bottom: 1px solid var(--color-rule);
  }

  td {
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-rule-soft);
    vertical-align: top;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover td {
    background: var(--color-accent-light);
  }

  th.num,
  td.num {
    text-align: right;
    font-family: var(--font-mono);
    white-space: nowrap;
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

  .muted {
    color: var(--color-text-muted);
  }

  /* --- Selection + actions --- */
  th.pick,
  td.pick {
    width: 1%;
    padding-right: 0;
  }

  th.actions,
  td.actions {
    width: 1%;
    white-space: nowrap;
    text-align: right;
  }

  td.actions {
    display: table-cell;
  }

  /* A wrapper, not the cell itself: `display: flex` on a <td> drops it out of the table
     layout, so the column stops aligning and empty cells render as stray boxes. */
  .flags {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  tbody tr.selected td {
    background: var(--color-accent-light);
  }

  /* Visible to screen readers only — column headers that carry no visible label. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
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

  .placeholder {
    padding: var(--sp-lg);
    font-size: var(--text-sm);
  }

  .placeholder .sub {
    margin-top: var(--sp-xs);
  }
</style>
