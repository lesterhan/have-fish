<script lang="ts">
  // Read-only narrated view of a transaction — the single transaction surface (view mode).
  // Renders three layers over the narration model (narration.ts): a HERO (what the money was
  // for), a plain-language BLURB (blurb.ts), and a HOW IT MOVED flow tree (the real source
  // asset as a dot, branching into role-chipped destinations). Progressive-disclosure
  // expanders (currency conversion, all postings) land in story 5; the Edit seam in story 6.
  //
  // Mode-ready contract (Flow Narration epic, Architecture): `mode` is 'view' | 'edit'
  // (default 'view'; 'edit' renders identically for now — a placeholder seam). The hero and
  // each branch are discrete, individually addressable rows (data-node / data-posting-id) so a
  // future edit mode swaps them into controls in place rather than via a child modal. `onedit`
  // is the actions affordance — when a parent passes it, an Edit control appears (wired in
  // story 6). No edit logic lives here yet.
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { narrateTransaction, accountLabel } from './narration'
  import { blurbFor } from './blurb'
  import {
    headerTag,
    chipLabel,
    chipTone,
    heroDisplay,
    branchAmount,
    orderedBranches,
    convertedNote,
    conversionRows,
    conversionHint,
    postingRows,
    formatTxDate,
  } from './detailView'
  import type { Transaction } from '$lib/api'

  interface Props {
    tx: Transaction
    mode?: 'view' | 'edit'
    onedit?: () => void
  }

  let { tx, mode = 'view', onedit }: Props = $props()

  let n = $derived(narrateTransaction(tx.postings))
  let hero = $derived(heroDisplay(n))
  let blurb = $derived(blurbFor(n))
  let tag = $derived(headerTag(n, tx.groupName))
  let note = $derived(convertedNote(n))
  let dateLabel = $derived(formatTxDate(tx.date))
  let sourceLabel = $derived(n.source ? accountLabel(n.source) : null)
  let branches = $derived(orderedBranches(n.branches))

  // Progressive disclosure — both collapsed by default, independent. Conversion only exists on
  // an FX transaction; All postings is always available (the raw-ledger escape hatch).
  let convRows = $derived(conversionRows(n))
  let convHint = $derived(conversionHint(n))
  let legs = $derived(postingRows(n))
  let convOpen = $state(false)
  let postingsOpen = $state(false)
</script>

<div class="detail" data-mode={mode}>
  <header class="head">
    <div class="head-main">
      <span class="payee">{tx.description || '—'}</span>
      {#if tag}
        {#if tag.kind === 'fishpie'}
          <!-- Two-chip Fish Pie identity, shared with the import preview (FishPiePills):
               accent category chip + muted group chip. -->
          <span class="fp-tag">
            <span class="fp-hero"><Icon name="pie" size={11} />{tag.category}</span>
            <span class="fp-sub">{tag.group}</span>
          </span>
        {:else}
          <span class="tag">{tag.label}</span>
        {/if}
      {/if}
    </div>
    <div class="head-side">
      <span class="date">{dateLabel}</span>
      {#if onedit}
        <GradientButton onclick={onedit}>Edit</GradientButton>
      {/if}
    </div>
  </header>

  {#if hero}
    <div class="hero" class:inflow={hero.positive} data-node="hero">
      <div class="hero-id">
        <span class="hero-label">{hero.label}</span>
        <span class="hero-path">{hero.path}</span>
      </div>
      <div class="hero-amount">
        <span class="num">{hero.sign}{hero.amount}</span>
        <CurrencyPill code={hero.currency} size="sm" />
      </div>
    </div>
  {/if}

  <p class="blurb">
    {#each blurb as seg}{#if seg.kind === 'break'}<br />{:else}<span class="seg" class:emph={seg.kind === 'emph'}>{seg.text}</span>{/if}{/each}
  </p>

  {#if n.source || n.branches.length > 0}
    <section class="moved">
      <span class="moved-label">How it moved</span>

      <div class="tree">
        {#if sourceLabel && n.source}
          <div class="row source">
            <span class="spine" aria-hidden="true"><span class="dot"></span></span>
            <div class="body">
              <span class="line"><span class="branch-label">{sourceLabel}</span></span>
              <span class="branch-path">{n.source.accountPath}</span>
            </div>
            <div class="amount">
              <span class="num">{branchAmount(n.source.amount)}</span>
              <CurrencyPill code={n.source.currency} size="xs" />
            </div>
          </div>
        {/if}

        {#each branches as b, i (b.posting.id)}
          <div
            class="row branch tone-{chipTone(b.chip)}"
            class:last={i === branches.length - 1}
            data-node="branch"
            data-posting-id={b.posting.id}
          >
            <span class="spine" aria-hidden="true"><span class="elbow"></span></span>
            <div class="body">
              <span class="line">
                <span class="chip">{chipLabel(b.chip)}</span>
                <span class="branch-label">{b.label}</span>
                {#if note && b.chip === 'the-spend'}
                  <span class="note">{note}</span>
                {/if}
              </span>
              <span class="branch-path">{b.path}</span>
            </div>
            <div class="amount">
              <span class="num">{branchAmount(b.amount)}</span>
              <CurrencyPill code={b.currency} size="xs" />
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if convRows}
    <section class="expander">
      <button
        type="button"
        class="caret-row"
        aria-expanded={convOpen}
        onclick={() => (convOpen = !convOpen)}
      >
        <span class="caret" class:open={convOpen} aria-hidden="true">
          <Icon name="chevron-right-filled" size={10} />
        </span>
        <span class="caret-label">Currency conversion</span>
        <span class="caret-hint">{convHint}</span>
      </button>
      {#if convOpen}
        <div class="conv-grid">
          {#each convRows as r (r.label)}
            <span class="conv-key">{r.label}</span>
            <span class="conv-val">
              <span class="num">{r.amount}</span>
              <CurrencyPill code={r.currency} size="xs" />
            </span>
          {/each}
          <span class="conv-key">Rate</span>
          <span class="conv-val"><span class="rate">{convHint}</span></span>
        </div>
      {/if}
    </section>
  {/if}

  <section class="expander">
    <button
      type="button"
      class="caret-row"
      aria-expanded={postingsOpen}
      onclick={() => (postingsOpen = !postingsOpen)}
    >
      <span class="caret" class:open={postingsOpen} aria-hidden="true">
        <Icon name="chevron-right-filled" size={10} />
      </span>
      <span class="caret-label">All postings</span>
      <span class="caret-hint">{legs.length} leg{legs.length === 1 ? '' : 's'}</span>
    </button>
    {#if postingsOpen}
      <div class="ledger">
        {#each legs as leg, i (leg.path + ':' + i)}
          <div class="leg">
            <span class="leg-path">{leg.path}</span>
            <span class="leg-role">{leg.role}</span>
            <span class="leg-amount">
              <span class="num" class:neg={leg.amount.startsWith('-')}>{leg.amount}</span>
              <CurrencyPill code={leg.currency} size="xs" />
            </span>
          </div>
        {/each}
        <div class="ledger-foot" class:ok={n.balances.ok}>
          {#if n.balances.ok}
            <Icon name="check" size={11} />balances
          {:else}
            <Icon name="warning" size={11} />does not balance
          {/if}
        </div>
      </div>
    {/if}
  </section>
</div>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    min-width: min(24rem, 82vw);
    max-width: min(32rem, 90vw);
  }

  /* --- header ------------------------------------------------------------------------ */
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-md);
    border-bottom: 1px solid var(--color-rule);
    padding-bottom: var(--sp-sm);
  }

  .head-main {
    display: flex;
    align-items: baseline;
    gap: var(--sp-sm);
    min-width: 0;
  }

  .payee {
    font-family: var(--font-serif);
    font-size: var(--text-lg);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    flex-shrink: 0;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 600;
    padding: 1px 6px;
    color: var(--color-accent);
    background: var(--color-accent-light);
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
    border-radius: var(--radius-lg);
    white-space: nowrap;
  }

  /* Two-chip Fish Pie identity — mirrors FishPiePills (import preview) so the
     category-vs-group distinction reads the same everywhere. */
  .fp-tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .fp-hero {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    background: var(--color-accent-light);
    border: 1px solid var(--color-accent);
    color: var(--color-accent-chip-fg);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }

  .fp-sub {
    display: inline-block;
    padding: 2px 6px;
    background: var(--color-window-raised);
    border: 1px solid var(--color-rule);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    white-space: nowrap;
  }

  .head-side {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    flex-shrink: 0;
  }

  .date {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  /* --- hero -------------------------------------------------------------------------- */
  .hero {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-md);
  }

  .hero-id {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .hero-label {
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hero-path {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hero-amount {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    flex-shrink: 0;
  }

  .hero-amount .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-xl);
    color: var(--color-text);
  }

  .hero.inflow .num {
    color: var(--color-amount-positive);
  }

  /* --- blurb ------------------------------------------------------------------------- */
  .blurb {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--color-text-muted);
  }

  .seg.emph {
    color: var(--color-text);
    font-weight: 600;
  }

  /* --- how it moved (flow tree) ------------------------------------------------------ */
  .moved {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    padding-top: var(--sp-sm);
    border-top: 1px dotted var(--color-rule);
  }

  .moved-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }

  .tree {
    display: grid;
    grid-template-columns: 18px 1fr auto;
  }

  .row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    align-items: center;
    column-gap: var(--sp-sm);
    min-height: 2.1rem;
  }

  /* The spine: a full-height vertical rule each row paints in its left cell, with the dot
     (source) or elbow (branch) sitting on it. The last branch trims the rule below its tick. */
  .spine {
    position: relative;
    align-self: stretch;
    width: 18px;
  }

  .spine::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--color-rule);
  }

  .source .spine::before {
    top: 50%;
  }

  .branch.last .spine::before {
    bottom: 50%;
  }

  .dot {
    position: absolute;
    left: 4px;
    top: 50%;
    transform: translateY(-50%);
    width: 9px;
    height: 9px;
    background: var(--color-accent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 60%, #000);
    border-radius: 50%;
  }

  .elbow {
    position: absolute;
    left: 8px;
    top: 50%;
    width: 8px;
    height: 1px;
    background: var(--color-rule);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    padding: var(--sp-xs) 0;
  }

  .line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-xs);
    min-width: 0;
  }

  .chip {
    font-family: var(--font-sans);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    color: var(--color-text-muted);
    background: var(--color-window-raised);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-lg);
    white-space: nowrap;
  }

  .tone-accent .chip {
    color: var(--color-accent);
    background: var(--color-accent-light);
    border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
  }

  .tone-positive .chip {
    color: var(--color-amount-positive);
    background: color-mix(in srgb, var(--color-amount-positive) 12%, var(--color-window));
    border-color: color-mix(in srgb, var(--color-amount-positive) 35%, transparent);
  }

  .tone-amber .chip {
    color: var(--color-warning);
    background: var(--color-warning-light);
    border-color: color-mix(in srgb, var(--color-warning) 35%, transparent);
  }

  .branch-label {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source .branch-label {
    color: var(--color-text-muted);
  }

  .branch-path {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .note {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-accent);
  }

  .amount {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    flex-shrink: 0;
    justify-self: end;
  }

  .amount .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .tone-positive .amount .num {
    color: var(--color-amount-positive);
  }

  .tone-accent .amount .num {
    color: var(--color-accent);
  }

  .tone-amber .amount .num {
    color: var(--color-warning);
  }

  /* --- progressive-disclosure expanders ---------------------------------------------- */
  .expander {
    border-top: 1px dotted var(--color-rule);
    padding-top: var(--sp-sm);
  }

  .caret-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    width: 100%;
    padding: var(--sp-xs) 0;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text);
    transition: color var(--duration-fast) var(--ease);
  }

  .caret-row:hover {
    color: var(--color-accent);
  }

  .caret-row:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 2px;
  }

  .caret {
    display: inline-flex;
    color: var(--color-text-muted);
    transition: transform var(--duration-fast) var(--ease);
  }

  .caret.open {
    transform: rotate(90deg);
  }

  .caret-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }

  .caret-hint {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* conversion grid */
  .conv-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: var(--sp-xs) var(--sp-md);
    padding: var(--sp-sm) 0 var(--sp-xs) calc(10px + var(--sp-sm));
  }

  .conv-key {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .conv-val {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp-xs);
  }

  .conv-val .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .rate {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  /* all-postings ledger */
  .ledger {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--sp-sm) 0 0 calc(10px + var(--sp-sm));
  }

  .leg {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    column-gap: var(--sp-sm);
  }

  .leg-path {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .leg-role {
    font-family: var(--font-sans);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .leg-amount {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    justify-self: end;
  }

  .leg-amount .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-xs);
    color: var(--color-text);
  }

  .leg-amount .num.neg {
    color: var(--color-amount-negative);
  }

  .ledger-foot {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    margin-top: var(--sp-xs);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-warning);
  }

  .ledger-foot.ok {
    color: var(--color-amount-positive);
  }
</style>
