<script lang="ts">
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import type { Account, ImportPreviewResult, ExpenseGroup } from '$lib/api'
  import ImportRowTransfer from './ImportRowTransfer.svelte'
  import ImportRowRegular from './ImportRowRegular.svelte'
  import { rowMissingAccounts } from './import-helpers'
  import type { RowState } from './row-state'
  import {
    REVIEW_FILTERS,
    rowStatus,
    statusCounts,
    matchesFilter,
    reviewedCount,
    nextUnreviewedIndex,
    dayBoundaries,
    type ReviewFilter,
  } from './review-status'

  interface Props {
    preview: ImportPreviewResult
    rowStates: RowState[]
    accounts: Account[]
    groups: ExpenseGroup[]
    currentUserId: string
    importAsLiabilities: boolean
    defaultCurrency: string
    loading: boolean
    error: string
    // Currencies that still have no account. Non-empty only when a row was flipped to
    // convert-and-park after the Accounts step ran.
    unmappedCurrencies: string[]
    onaccountcreated: (account: Account) => void
    // Records that this row's assignment is now the user's, not a rule's or a cluster's.
    onrowedited: (index: number) => void
    onsaverule: (index: number) => void
    onconfirm: () => void
    oncancel: () => void
  }

  let {
    preview,
    rowStates = $bindable(),
    accounts,
    groups,
    currentUserId,
    importAsLiabilities,
    defaultCurrency,
    loading,
    error,
    unmappedCurrencies,
    onaccountcreated,
    onrowedited,
    onsaverule,
    onconfirm,
    oncancel,
  }: Props = $props()

  let splitSelectOpenIndex = $state<number | null>(null)

  // --- Review filtering ---
  //
  // The table is never reordered — filtering removes rows from it instead. Importing a
  // month-old statement means reconstructing the day to decide whether a row was coffee or
  // groceries, and regrouping by anything but date destroys that context.

  let filter = $state<ReviewFilter>('needs-review')
  let counts = $derived(statusCounts(rowStates))
  let reviewed = $derived(reviewedCount(rowStates))

  let visibleIndices = $derived(
    preview.transactions
      .map((_, i) => i)
      .filter((i) => rowStates[i] && matchesFilter(rowStatus(rowStates[i]), filter)),
  )

  let dayStarts = $derived(dayBoundaries(preview.transactions, visibleIndices))

  // The row `n` last jumped to, so repeated presses walk forward instead of sticking.
  let cursor = $state(-1)

  function jumpToNextUnreviewed() {
    const next = nextUnreviewedIndex(rowStates, cursor)
    if (next < 0) return
    cursor = next
    // Showing a needs-review row inside a filter that excludes it would scroll to nothing.
    if (!matchesFilter('needs-review', filter)) filter = 'needs-review'
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-row-index="${next}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.querySelector<HTMLElement>('button, input')?.focus()
    })
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement | null
    // Don't hijack the letter while the user is typing into a picker.
    if (target?.closest('input, textarea, select, [contenteditable]')) return
    e.preventDefault()
    jumpToNextUnreviewed()
  }

  function dayLabel(date: string): string {
    const d = new Date(date)
    return Number.isNaN(d.getTime())
      ? date
      : d.toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
  }

  // Column count, for the day-header row's colspan.
  let columnCount = $derived(
    5 + (preview.isMultiCurrency ? 0 : 1) + (groups.length > 0 ? 1 : 0),
  )

  let confirmDisabled = $derived(
    loading ||
      rowStates.every((r) => r.skipped) ||
      unmappedCurrencies.length > 0 ||
      rowStates.some(
        (row, i) =>
          !row.skipped && rowMissingAccounts(preview.transactions[i], row),
      ),
  )
</script>

<svelte:window onkeydown={handleKey} />

<div class="preview-window">
  <div class="section-bar">
    <span class="section-bar-title">REVIEW — {preview.parser}</span>
    <span class="preview-counts">
      {reviewed} of {counts.all} reviewed
    </span>
  </div>
  <div class="preview-body">
    {#if preview.errors.length > 0}
      <div class="parse-errors">
        <p>
          {preview.errors.length} row(s) could not be parsed and will be skipped.
        </p>
        <ul>
          {#each preview.errors as e}
            <li>Row {e.row}: {e.reason}</li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if unmappedCurrencies.length > 0}
      <div class="unmapped-notice">
        Flipping a row to convert-and-park needs an account for
        {#each unmappedCurrencies as c, i}<code>{c}</code>{#if i < unmappedCurrencies.length - 1}, {/if}{/each}.
        Go back to the Accounts step to map
        {unmappedCurrencies.length === 1 ? 'it' : 'them'}.
      </div>
    {/if}

    <div class="liability-bar">
      <!-- Derived from the import account, set on the File step. Shown here as a
           reminder that amounts are negated, not as a control. -->
      <span class="liability-chip" class:hidden={!importAsLiabilities}>
        Imported as liabilities
      </span>
      <div class="bar-actions">
        <GradientButton onclick={oncancel}>Cancel</GradientButton>
        <GradientButton onclick={onconfirm} disabled={confirmDisabled} active>
          {loading ? 'Importing…' : 'Confirm import'}
        </GradientButton>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filters" role="group" aria-label="Filter rows">
        {#each REVIEW_FILTERS as f (f.id)}
          <button
            type="button"
            class="chip"
            class:active={filter === f.id}
            aria-pressed={filter === f.id}
            disabled={counts[f.id] === 0 && filter !== f.id}
            onclick={() => (filter = f.id)}
          >
            {f.label}
            <span class="chip-count">{counts[f.id]}</span>
          </button>
        {/each}
      </div>
      <span class="jump-hint">
        Press <kbd>n</kbd> for the next unreviewed row
      </span>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th class="col-date">Date</th>
            <th class="col-description">Description</th>
            <th class="col-amount">Amount</th>
            {#if !preview.isMultiCurrency}<th>Currency</th>{/if}
            <th class="col-offset">To account</th>
            {#if groups.length > 0}<th class="col-split">Fish Pie</th>{/if}
            <th class="col-skip">Skip</th>
          </tr>
        </thead>
        <tbody>
          {#if visibleIndices.length === 0}
            <tr>
              <td class="empty-filter" colspan={columnCount}>
                Nothing here — every row is accounted for under this filter.
              </td>
            </tr>
          {/if}
          {#each visibleIndices as i (i)}
            {@const tx = preview.transactions[i]}
            {#if dayStarts.has(i)}
              <tr class="day-header">
                <th class="day-cell" colspan={columnCount} scope="colgroup">
                  {dayLabel(tx.date)}
                </th>
              </tr>
            {/if}
            {#if tx.isTransfer === false}
              <ImportRowRegular
                {tx}
                bind:rowState={rowStates[i]}
                {accounts}
                {groups}
                {currentUserId}
                isMultiCurrency={preview.isMultiCurrency}
                {importAsLiabilities}
                {defaultCurrency}
                splitSelectOpen={splitSelectOpenIndex === i}
                showFishPie={groups.length > 0}
                onsplitopen={() => (splitSelectOpenIndex = i)}
                onclosesplit={() => (splitSelectOpenIndex = null)}
                {onaccountcreated}
                status={rowStatus(rowStates[i])}
                index={i}
                canSaveRule={!!tx.merchantKey}
                onedited={() => onrowedited(i)}
                onsaverule={() => onsaverule(i)}
              />
            {:else}
              <ImportRowTransfer
                {tx}
                bind:rowState={rowStates[i]}
                {accounts}
                {groups}
                {currentUserId}
                splitSelectOpen={splitSelectOpenIndex === i}
                showFishPie={groups.length > 0}
                onsplitopen={() => (splitSelectOpenIndex = i)}
                onclosesplit={() => (splitSelectOpenIndex = null)}
                {onaccountcreated}
                status={rowStatus(rowStates[i])}
                index={i}
                canSaveRule={!!tx.merchantKey}
                onedited={() => onrowedited(i)}
                onsaverule={() => onsaverule(i)}
              />
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <div class="panel-actions">
    {#if error}
      <p class="error">{error}</p>
    {/if}
    <div class="action-buttons">
      <GradientButton onclick={oncancel}>Cancel</GradientButton>
      <GradientButton onclick={onconfirm} disabled={confirmDisabled} active>
        {loading ? 'Importing…' : 'Confirm import'}
      </GradientButton>
    </div>
  </div>
</div>

<style>
  .preview-window {
    background: var(--color-window);
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
    flex: 1;
    white-space: nowrap;
  }

  .preview-counts {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-section-bar-fg);
    opacity: 0.75;
    white-space: nowrap;
  }

  .preview-body {
    display: flex;
    flex-direction: column;
  }





  .parse-errors {
    font-size: var(--text-sm);
    color: var(--color-danger);
    background: var(--color-danger-light);
    border-left: 3px solid var(--color-danger);
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-rule);
  }

  .parse-errors p {
    margin: 0 0 var(--sp-xs);
    font-weight: var(--weight-semibold);
  }

  .parse-errors ul {
    margin: 0;
    padding-left: var(--sp-md);
  }





  .liability-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
  }

  /* Narrow late gate: the Accounts step covers everything the preview expected, so this
     only appears when a row was flipped to convert-and-park afterwards. */
  .unmapped-notice {
    padding: var(--sp-sm) var(--sp-md);
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window-raised);
    color: var(--color-amount-negative);
    font-size: var(--text-sm);
  }

  .unmapped-notice code {
    font-family: var(--font-mono);
  }

  /* ── Filter bar ── */

  .filter-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-md);
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window);
  }

  .filters {
    display: flex;
    gap: var(--sp-xs);
    flex-wrap: wrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-pill);
    background: var(--color-window-raised);
    box-shadow: var(--shadow-control);
    color: var(--color-text);
    font-size: var(--text-xs);
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .chip:hover:not(:disabled) {
    border-color: var(--color-accent);
  }

  .chip:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 1px;
  }

  .chip.active {
    background: var(--color-accent);
    border-color: var(--color-accent);
    box-shadow: var(--shadow-inset);
    color: var(--color-accent-fg);
  }

  /* An empty bucket stays visible so its count reads as zero rather than vanishing. */
  .chip:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .chip-count {
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.8;
  }

  .jump-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .jump-hint kbd {
    padding: 1px 5px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-window-raised);
    box-shadow: var(--shadow-control);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  /* ── Day headers ── */

  .day-header .day-cell {
    position: sticky;
    top: 0;
    z-index: 2;
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-raised);
    border-bottom: 1px solid var(--color-rule);
    text-align: left;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .empty-filter {
    padding: var(--sp-lg) var(--sp-md);
    text-align: center;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .liability-chip {
    display: inline-flex;
    align-items: center;
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

  /* Held in the layout so the action buttons keep their position when the chip is off. */
  .liability-chip.hidden {
    visibility: hidden;
  }

  .bar-actions {
    display: flex;
    gap: var(--sp-sm);
  }

  /* ── Table structure ── */

  .table-container {
    background: var(--color-window-inset);
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th {
    background: var(--color-window);
    box-shadow: none;
    border-bottom: 1px solid var(--color-rule);
    padding: 4px 12px;
    text-align: left;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    white-space: nowrap;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  /* Date and Description are reference columns — give them only what they need so the
     load-bearing Amount and the high-interaction To-account columns get the room. */
  .col-date {
    width: 5rem;
  }
  .col-description {
    width: 30rem;
    max-width: 30rem;
  }
  .col-amount {
    width: 8.5rem;
    text-align: right;
  }
  .col-offset {
    width: 100%;
    min-width: 12rem;
  }
  .col-split {
    width: 7rem;
    text-align: center;
  }
  .col-skip {
    width: 3rem;
    text-align: center;
  }

  /* ── Shared row/cell styles — :global so they reach child-rendered <td> elements ── */

  :global(.table-container td) {
    padding: 5px 12px;
    border-bottom: 1px solid var(--color-rule-soft);
    font-size: var(--text-xs);
  }

  :global(.table-container tbody tr:last-child td) {
    border-bottom: none;
  }

  :global(.table-container tbody tr:hover td) {
    background: var(--color-accent-light);
  }

  /* Description is a reference cue, not the focus — clip overflow to keep column width
     in check (full text stays available via the cell's title attribute). */
  :global(.table-container .cell-description) {
    max-width: 30rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
  }

  :global(.table-container .cell-offset) {
    padding: 0;
  }

  /* Labelled mini-field used across every To-account treatment — single input, conversion
     leg, or Fish Pie pills. The fixed label gutter keeps content left-aligned row to row so
     the column reads as one form. `.no-label` opts a row out (plain bank imports, where
     there's nothing to align against) without changing its markup. */
  :global(.table-container .field) {
    display: grid;
    grid-template-columns: 3rem 1fr;
    align-items: center;
    gap: var(--sp-xs);
  }
  :global(.table-container .field.no-label) {
    display: contents;
  }
  :global(.table-container .field-label) {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    text-align: right;
    user-select: none;
  }

  /* Fills the field's input column; the group dropdown measures this to align itself. */
  :global(.table-container .split-anchor) {
    min-width: 0;
  }

  :global(.table-container .cell-skip) {
    text-align: center;
    vertical-align: middle;
  }

  :global(.table-container .cell-split) {
    text-align: center;
    vertical-align: middle;
    padding: 2px 4px;
    white-space: nowrap;
  }

  :global(.table-container .row-skipped td) {
    opacity: 0.4;
  }

  :global(.table-container .row-skipped .cell-skip) {
    opacity: 1;
  }

  :global(.table-container .indicator-icon) {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--color-accent);
    cursor: default;
    vertical-align: middle;
    margin-left: var(--sp-xs);
  }

  /* ── Panel footer ── */

  .panel-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    border-top: 1px solid var(--color-rule);
    background: linear-gradient(
      180deg,
      var(--color-window),
      var(--color-window-raised)
    );
  }

  .error {
    flex: 1;
    font-size: var(--text-xs);
    color: var(--color-danger);
  }

  .action-buttons {
    display: flex;
    gap: var(--sp-sm);
    margin-left: auto;
  }
</style>
