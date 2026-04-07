<script lang="ts">
  import { onMount } from "svelte";
  import HeadingBanner from "$lib/components/ui/HeadingBanner.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Panel from "$lib/components/ui/Panel.svelte";
  import Icon from "$lib/components/ui/Icon.svelte";
  import SpendingChart from "$lib/components/SpendingChart.svelte";
  import TransactionRow from "$lib/components/TransactionRow.svelte";
  import {
    fetchSpendingSummary,
    fetchTransactions,
    fetchAccounts,
  } from "$lib/api";
  import type { SpendingSummary, Account, Transaction } from "$lib/api";
  import { monthStart, monthEnd, shiftMonth, MONTH_NAMES } from "$lib/date";

  // --- State ---
  // Default to the previous calendar month — that's when data is typically complete
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  let year = $state(prev.getFullYear());
  let month = $state(prev.getMonth() + 1);

  let summary = $state<SpendingSummary | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let currency = $state("CAD");
  // null = top level; a category path like "expenses:food" = drilled into that subtree
  let drillPath = $state<string | null>(null);

  let currencies = $derived(Object.keys(summary?.total ?? {}));

  let accounts = $state<Account[]>([]);
  let txns = $state<Transaction[]>([]);
  let txnsLoading = $state(false);

  let txnPanelTitle = $derived.by(() => {
    const label = drillPath
      ? drillPath.split(":").slice(1).join(":") || drillPath
      : null;
    const count = txnsLoading ? "" : ` (${txns.length})`;
    return label ? `Transactions — ${label}${count}` : `Transactions${count}`;
  });

  // Breadcrumb trail derived from drillPath.
  // Each crumb has a label (title-cased segment), the path to navigate to (null = top), and
  // whether it is the current (non-clickable) level.
  type Crumb = { label: string; path: string | null; current: boolean };
  let breadcrumbs = $derived.by<Crumb[]>(() => {
    // Derive the root segment from drillPath or the first category in the summary
    const root =
      drillPath?.split(":")[0] ??
      summary?.categories[0]?.category.split(":")[0] ??
      "expenses";
    const rootLabel = root.charAt(0).toUpperCase() + root.slice(1);

    if (!drillPath) return [{ label: rootLabel, path: null, current: true }];

    const segments = drillPath.split(":").slice(1); // skip root segment
    const crumbs: Crumb[] = [{ label: rootLabel, path: null, current: false }];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      crumbs.push({
        label: seg.charAt(0).toUpperCase() + seg.slice(1),
        path: [root, ...segments.slice(0, i + 1)].join(":"),
        current: i === segments.length - 1,
      });
    }
    return crumbs;
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const result = await fetchSpendingSummary(
        monthStart(year, month),
        monthEnd(year, month),
        drillPath ?? undefined,
      );
      summary = result;
      // Keep current currency if still present in the new data; otherwise fall back
      const available = Object.keys(result.total);
      if (available.length > 0 && !available.includes(currency)) {
        currency = available[0];
      }
    } catch {
      error = "Failed to load spending data.";
    } finally {
      loading = false;
    }
  }

  async function loadTxns() {
    txnsLoading = true;
    const accountPath =
      drillPath ?? summary?.categories[0]?.category.split(":")[0] ?? "expenses";
    try {
      txns = await fetchTransactions({
        from: monthStart(year, month),
        to: monthEnd(year, month),
        accountPath,
      });
    } catch {
      txns = [];
    } finally {
      txnsLoading = false;
    }
  }

  function navigate(delta: number) {
    const next = shiftMonth(year, month, delta);
    year = next.year;
    month = next.month;
    drillPath = null;
    load().then(loadTxns);
  }

  // Drill into a category — called by SpendingChart when a drillable bar is clicked
  function drill(category: string) {
    drillPath = category;
    load();
    loadTxns();
  }

  // Navigate back to an earlier breadcrumb level
  function navigateTo(path: string | null) {
    drillPath = path;
    load();
    loadTxns();
  }

  onMount(() => {
    fetchAccounts().then((a) => {
      accounts = a;
    });
    load().then(loadTxns);
  });
</script>

<HeadingBanner><h1>Spending Breakdown</h1></HeadingBanner>

<div class="page">
  <!-- Toolbar: month nav + filters. Account filter will slot in here too. -->
  <div class="toolbar">
    <div class="toolbar-group">
      <Button
        variant="ghost"
        square
        onclick={() => navigate(-1)}
        aria-label="Previous month"
      >
        <Icon name="left-circle" size={18} />
      </Button>
      <span class="month-label">{MONTH_NAMES[month - 1]} {year}</span>
      <Button
        variant="ghost"
        square
        onclick={() => navigate(1)}
        aria-label="Next month"
      >
        <Icon name="right-circle" size={18} />
      </Button>
    </div>

    {#if currencies.length > 1}
      <div class="toolbar-sep"></div>
      <select
        class="toolbar-select"
        bind:value={currency}
        aria-label="Currency"
      >
        {#each currencies as c}
          <option value={c}>{c}</option>
        {/each}
      </select>
    {/if}
  </div>

  {#if loading}
    <p class="status">Loading…</p>
  {:else if error}
    <p class="status error">{error}</p>
  {:else if !summary || currencies.length === 0}
    <p class="status">No expenses recorded for this month.</p>
  {:else}
    <Panel title="Breakdown">
      <div class="panel-body">
        <nav class="breadcrumb" aria-label="Category navigation">
          {#each breadcrumbs as crumb, i}
            {#if i > 0}<span class="sep" aria-hidden="true">:</span>{/if}
            {#if crumb.current}
              <span class="crumb crumb-current">{crumb.label}</span>
            {:else}
              <button
                class="crumb crumb-link"
                onclick={() => navigateTo(crumb.path)}
              >
                {crumb.label}
              </button>
            {/if}
          {/each}
        </nav>

        <SpendingChart
          categories={summary.categories}
          {currency}
          onclick={drill}
        />
      </div>
    </Panel>

    <Panel title={txnPanelTitle}>
      {#if txnsLoading}
        <p class="status">Loading…</p>
      {:else if txns.length === 0}
        <p class="status">No transactions found.</p>
      {:else}
        <div class="txn-list">
          {#each txns as tx (tx.id)}
            <TransactionRow
              {tx}
              {accounts}
              ondeleted={() => {
                txns = txns.filter((t) => t.id !== tx.id);
              }}
            />
          {/each}
        </div>
      {/if}
    </Panel>
  {/if}
</div>

<style>
  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window);
    box-shadow: var(--shadow-sunken);
    margin-bottom: var(--sp-lg);
  }

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  /* Vertical separator between toolbar sections */
  .toolbar-sep {
    width: 1px;
    height: 16px;
    background: var(--color-bevel-dark);
    margin: 0 var(--sp-xs);
    flex-shrink: 0;
  }

  .month-label {
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    min-width: 110px;
    text-align: center;
  }

  .toolbar-select {
    background: var(--color-window);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 1px var(--sp-xs);
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    color: var(--color-text);
    cursor: pointer;
  }

  /* Panel body padding */
  .panel-body {
    padding: var(--sp-md);
  }

  .status {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--sp-md) 0;
  }

  .status.error {
    color: var(--color-danger);
  }

  .txn-list {
    display: flex;
    flex-direction: column;
  }

  /* Breadcrumb */
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    margin-bottom: var(--sp-md);
    font-size: var(--text-sm);
  }

  .sep {
    color: var(--color-text-muted);
    font-weight: 700;
  }

  .crumb-current {
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .crumb-link {
    background: none;
    border: none;
    padding: 0;
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    color: var(--color-accent);
    cursor: pointer;
    text-decoration: underline;
    transition: color var(--duration-fast) var(--ease);
  }

  .crumb-link:hover {
    color: var(--color-accent-mid);
  }
</style>
