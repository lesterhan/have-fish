<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import Card from '$lib/components/ui/Card.svelte'
  import Chip from '$lib/components/ui/Chip.svelte'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import Select from '$lib/components/ui/Select.svelte'
  import Shimmer from '$lib/components/ui/Shimmer.svelte'
  import TabStrip, { type TabItem } from '$lib/components/ui/TabStrip.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import {
    fetchAccountBalances,
    fetchAccountPostingCounts,
    fetchFxRateAsOf,
    toClassifierType,
  } from '$lib/api'
  import type { AccountBalance, UserSettings } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import { rank } from '$lib/components/accounts/accountScorer'
  import {
    ACCOUNT_SURFACES,
    STALE_AFTER_DAYS,
    buildRows,
    convertRows,
    currenciesNeedingRates,
    formatCents,
    groupCurrency,
    groupRows,
    localToday,
    positionTotals,
    toCents,
    type Grouping,
    type Group,
    type PositionBucket,
    type Rates,
    type Roots,
    type Row,
  } from '$lib/components/accounts/accountsOverview'

  // ── Tab, mirrored in the URL ──────────────────────────────
  // `?tab=` keeps the two halves of the page linkable — story 7 redirects the retired
  // /accounts/manage route straight at the Categories tab.
  const TABS: TabItem[] = [
    { id: 'accounts', label: 'Accounts' },
    { id: 'categories', label: 'Categories' },
  ]

  // Owing reads as a magnitude under its own label rather than a signed figure: a card that
  // owes 3,759 is not an error, and a minus sign there is an alarm that never stops going off.
  const POSITION_CARDS: { key: PositionBucket; label: string; magnitude?: boolean }[] = [
    { key: 'cash', label: 'Cash' },
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

  const today = localToday()

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

  let roots = $derived<Roots>({
    assets: settings?.defaultAssetsRootPath ?? 'assets',
    liabilities: settings?.defaultLiabilitiesRootPath ?? 'liabilities',
    equity: settings?.defaultEquityRootPath ?? 'equity',
    expenses: settings?.defaultExpensesRootPath ?? 'expenses',
    income: settings?.defaultIncomeRootPath ?? 'income',
  })

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

  // Rates are fetched for whatever currencies are actually on the page, once they load.
  // A currency whose rate never arrives stays out of `rates` and surfaces as an excluded
  // balance rather than a wrong total.
  // Deliberately not reactive: it records which currencies have already been asked about, so
  // one that has no published rate is not re-fetched on every dependency change.
  const attempted = new Set<string>()

  $effect(() => {
    const wanted = currenciesNeedingRates(allRows, preferred).filter(
      (c) => !attempted.has(c),
    )
    if (wanted.length === 0) return
    for (const c of wanted) attempted.add(c)
    void Promise.all(
      wanted.map(async (from) => {
        const r = await fetchFxRateAsOf(from, preferred).catch(() => null)
        const rate = r ? Number(r.rate) : NaN
        return [from, Number.isFinite(rate) ? rate : null] as const
      }),
    ).then((pairs) => {
      const next = new Map(rates)
      let changed = false
      for (const [from, rate] of pairs) {
        if (rate !== null) {
          next.set(from, rate)
          changed = true
        }
      }
      if (changed) rates = next
    })
  })

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
      rates,
      preferred,
    ),
  )

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
    return convertRows([row], rates, preferred)
  }

  // A currency group totals natively — every row in it is already in that one currency, so
  // the sum is exact and needs no rate. Everything else converts to the preferred currency.
  function groupTotal(group: Group) {
    const native = groupCurrency(group)
    return {
      unit: native ?? preferred,
      approx: native === null,
      ...convertRows(group.rows, rates, native ?? preferred),
    }
  }
</script>

<svelte:head><title>Accounts · have-fish</title></svelte:head>

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
                {formatCents(card.magnitude ? Math.abs(bucket.cents) : bucket.cents)}
                <span class="position-currency">{preferred}</span>
              </span>
              {#if bucket.missing.length > 0}
                <span class="position-note" title="No exchange rate available">
                  excludes {bucket.missing.join(', ')}
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

        <span class="count">
          {visibleRows.length}
          {visibleRows.length === 1 ? 'account' : 'accounts'}
        </span>
      </div>

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
          <Card class="group-card">
            <button
              type="button"
              class="group-header"
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
              {#if total.missing.length > 0}
                <span class="group-note" title="No exchange rate available">
                  excludes {total.missing.join(', ')}
                </span>
              {/if}
            </button>

            {#if !collapsed[group.key]}
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Type</th>
                      <th class="num">Balance</th>
                      <th class="num">≈ {preferred}</th>
                      <th>Last activity</th>
                      <th>Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each group.rows as row (row.account.id)}
                      {@const converted = rowTotal(row)}
                      <tr>
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
                        <td class="num">
                          {#if converted.missing.length > 0}
                            <span class="muted" title="No exchange rate available">—</span>
                          {:else if row.balances.length === 0}
                            <span class="muted">—</span>
                          {:else}
                            {formatCents(converted.cents)}
                          {/if}
                        </td>
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
                          {#if hiddenIds.has(row.account.id)}
                            <Chip size="xs" icon="lock">hidden</Chip>
                          {/if}
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

  /* --- Groups --- */
  :global(.card.group-card) {
    overflow: hidden;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    width: 100%;
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-section-bar-bg, var(--color-window));
    color: var(--color-section-bar-fg, var(--color-text));
    border: none;
    border-bottom: 1px solid var(--color-rule);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease);
  }

  .group-header:hover {
    filter: brightness(1.25);
  }

  .group-header:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
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
