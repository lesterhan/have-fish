<script lang="ts">
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import type { ParsedTransaction } from '$lib/api'
  import type { Manifest } from './manifest'

  interface Props {
    manifest: Manifest
    transactions: ParsedTransaction[]
    parseErrors: { row: number; reason: string }[]
    parserName: string
    importAsLiabilities: boolean
    loading: boolean
    error: string
    onjumpto: (index: number) => void
    onreviewskipped: () => void
    onconfirm: () => void
    onback: () => void
  }

  let {
    manifest,
    transactions,
    parseErrors,
    parserName,
    importAsLiabilities,
    loading,
    error,
    onjumpto,
    onreviewskipped,
    onconfirm,
    onback,
  }: Props = $props()

  // Parse errors used to render as an uncapped list above the review table — a malformed
  // CSV put hundreds of items in front of every import. Collapsed here, and capped.
  const ERROR_PREVIEW = 10
  let showAllErrors = $state(false)
  let visibleErrors = $derived(showAllErrors ? parseErrors : parseErrors.slice(0, ERROR_PREVIEW))

  let canCommit = $derived(!loading && manifest.committedCount > 0 && manifest.incomplete.length === 0)

  function money(total: number | null, currency: string | null): string {
    if (total === null) return 'mixed currencies'
    return `−${total.toFixed(2)}${currency ? ` ${currency}` : ''}`
  }

  function rowLabel(index: number): string {
    const tx = transactions[index]
    if (!tx) return `Row ${index + 1}`
    return `${(tx.date ?? '').slice(0, 10)} · ${tx.description ?? 'no description'}`
  }
</script>

<div class="confirm-step">
  <div class="headline">
    <h2>
      {manifest.committedCount} transaction{manifest.committedCount === 1 ? '' : 's'}
    </h2>
    {#if manifest.dateRange}
      <span class="range">{manifest.dateRange.from} → {manifest.dateRange.to}</span>
    {/if}
    <span class="parser">via {parserName}</span>
    {#if importAsLiabilities}
      <span class="liability-chip">Imported as liabilities</span>
    {/if}
  </div>

  <!-- Per-destination totals are the point of this step: a bare row count cannot catch
       "everything landed in Uncategorized" before it is in the ledger. -->
  <div class="destinations">
    {#each manifest.lines as line (line.key)}
      <div class="destination" class:warn={line.isUncategorized}>
        <span class="arrow" aria-hidden="true">→</span>
        <span class="dest-label">{line.label}</span>
        <span class="dest-count">{line.count}</span>
        <span class="dest-total">{money(line.total, line.currency)}</span>
        {#if line.isUncategorized}
          <span class="warn-flag" title="These rows were never assigned an account">
            <Icon name="warning" size={13} /> uncategorized
          </span>
        {/if}
      </div>
    {:else}
      <p class="nothing">Every row is skipped — there is nothing to import.</p>
    {/each}
  </div>

  <dl class="notes">
    {#if manifest.skippedDuplicates > 0}
      <div class="note">
        <dt>{manifest.skippedDuplicates} skipped as duplicate{manifest.skippedDuplicates === 1 ? '' : 's'}</dt>
        <dd><button type="button" class="link" onclick={onreviewskipped}>review</button></dd>
      </div>
    {/if}
    {#if manifest.skippedManual > 0}
      <div class="note">
        <dt>{manifest.skippedManual} skipped by hand</dt>
        <dd><button type="button" class="link" onclick={onreviewskipped}>review</button></dd>
      </div>
    {/if}
    {#if manifest.rulesCreated.length > 0}
      <div class="note">
        <dt>{manifest.rulesCreated.length} import rule{manifest.rulesCreated.length === 1 ? '' : 's'} created</dt>
        <dd class="note-detail">{manifest.rulesCreated.join(', ')}</dd>
      </div>
    {/if}
    {#if manifest.accountsCreated.length > 0}
      <div class="note">
        <dt>{manifest.accountsCreated.length} account{manifest.accountsCreated.length === 1 ? '' : 's'} created</dt>
        <dd class="note-detail">{manifest.accountsCreated.join(', ')}</dd>
      </div>
    {/if}
  </dl>

  {#if parseErrors.length > 0}
    <details class="parse-errors">
      <summary>
        <Icon name="arrow-right" size={10} />
        {parseErrors.length} row{parseErrors.length === 1 ? '' : 's'} could not be parsed and will be skipped
      </summary>
      <ul>
        {#each visibleErrors as e (e.row)}
          <li><span class="err-row">Row {e.row}</span> {e.reason}</li>
        {/each}
      </ul>
      {#if !showAllErrors && parseErrors.length > ERROR_PREVIEW}
        <button type="button" class="link" onclick={() => (showAllErrors = true)}>
          {parseErrors.length - ERROR_PREVIEW} more
        </button>
      {/if}
    </details>
  {/if}

  {#if manifest.incomplete.length > 0}
    <!-- Replaces "All transactions must have accounts assigned", which named none of them. -->
    <div class="incomplete">
      <p class="incomplete-head">
        <Icon name="warning-filled" size={13} />
        {manifest.incomplete.length} row{manifest.incomplete.length === 1 ? '' : 's'} still
        {manifest.incomplete.length === 1 ? 'needs' : 'need'} an account:
      </p>
      <ul>
        {#each manifest.incomplete as index (index)}
          <li>
            <button type="button" class="link" onclick={() => onjumpto(index)}>
              {rowLabel(index)}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <div class="actions">
    <GradientButton onclick={onback}>Back to review</GradientButton>
    <span class="spacer"></span>
    <GradientButton size="lg" active disabled={!canCommit} onclick={onconfirm}>
      {#if loading}
        Importing…
      {:else if manifest.incomplete.length > 0}
        {manifest.incomplete.length} row{manifest.incomplete.length === 1 ? '' : 's'} to fix
      {:else}
        Import {manifest.committedCount} transaction{manifest.committedCount === 1 ? '' : 's'}
      {/if}
    </GradientButton>
  </div>
</div>

<style>
  .confirm-step {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    padding: var(--sp-md);
  }

  .headline {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--sp-sm);
  }

  .headline h2 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .range,
  .parser {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .liability-chip {
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

  .destinations {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    background: var(--color-window-raised);
    box-shadow: var(--shadow-inset);
    overflow: hidden;
  }

  .destination {
    display: grid;
    grid-template-columns: auto minmax(12rem, 1fr) 4rem 10rem auto;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-md);
    border-bottom: 1px solid var(--color-rule);
    font-size: var(--text-sm);
  }

  .destination:last-child {
    border-bottom: none;
  }

  .arrow {
    color: var(--color-text-muted);
  }

  .dest-label {
    font-family: var(--font-mono);
  }

  .dest-count,
  .dest-total {
    font-family: var(--font-mono);
    text-align: right;
  }

  .dest-count {
    color: var(--color-text-muted);
  }

  .dest-total {
    color: var(--color-amount-negative);
  }

  .destination.warn .dest-label {
    color: var(--color-amount-negative);
  }

  .warn-flag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-amount-negative);
  }

  .nothing {
    margin: 0;
    padding: var(--sp-md);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
  }

  .note {
    display: flex;
    align-items: baseline;
    gap: var(--sp-sm);
    font-size: var(--text-sm);
  }

  .note dt {
    font-variant-numeric: tabular-nums;
  }

  .note dd {
    margin: 0;
  }

  .note-detail {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .link {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-accent);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  .link:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 2px;
  }

  .parse-errors {
    font-size: var(--text-sm);
  }

  .parse-errors summary {
    cursor: pointer;
    color: var(--color-text-muted);
  }

  .parse-errors ul,
  .incomplete ul {
    margin: var(--sp-xs) 0 0;
    padding-left: var(--sp-lg);
  }

  .parse-errors li,
  .incomplete li {
    font-size: var(--text-xs);
  }

  .err-row {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
  }

  .incomplete {
    padding: var(--sp-sm) var(--sp-md);
    border-radius: var(--radius-lg);
    background: var(--color-window-raised);
    box-shadow: var(--shadow-inset);
  }

  .incomplete-head {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    margin: 0;
    color: var(--color-amount-negative);
    font-size: var(--text-sm);
  }

  .error {
    margin: 0;
    color: var(--color-amount-negative);
    font-size: var(--text-sm);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .spacer {
    flex: 1;
  }
</style>
