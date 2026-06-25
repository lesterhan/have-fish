<script lang="ts">
  // Read-only narrated view of a transaction. Renders by posting *role*, not as a flat
  // list of legs: leads with the meaningful spend/income, collapses the mechanical
  // conversion/transfer/fee legs into a plain-language "how it moved" section, and shows
  // Fish Pie clearing legs as "split with <group>". The shared detail component reused
  // across the app (transactions list, spending panel — story 4).
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import { narrateTransaction } from './narrate'
  import type { Transaction } from '$lib/api'

  interface Props {
    tx: Transaction
  }

  let { tx }: Props = $props()

  let n = $derived(narrateTransaction(tx.postings))

  // Absolute, 2dp — the narration conveys direction by account name, not by sign.
  function amt(amount: string): string {
    return Math.abs(parseFloat(amount)).toFixed(2)
  }

  let dateLabel = $derived.by(() => {
    const d = new Date(tx.date.substring(0, 10) + 'T00:00:00')
    return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  })

  // Whether there is anything mechanical to explain under "how it moved".
  let hasMovement = $derived(
    n.movement.source !== null || n.movement.flow !== null || n.movement.fees.length > 0,
  )
</script>

<div class="detail">
  <header class="head">
    <span class="desc">{tx.description || '—'}</span>
    <span class="date">{dateLabel}</span>
  </header>

  {#if n.simple}
    <!-- Common case: one compact line, source → subject. -->
    {@const s = n.subjects[0]}
    <div class="simple-line">
      {#if n.movement.source}
        <span class="from">{n.movement.source.accountPath}</span>
        <span class="arrow" aria-hidden="true">➜</span>
      {/if}
      <span class="to">{s.accountPath}</span>
      <span class="money">
        <CurrencyPill code={s.currency} size="xs" />
        <span class="amount">{amt(s.amount)}</span>
      </span>
    </div>
  {:else}
    <!-- Narrated: lead with the meaningful legs. -->
    {#if n.subjects.length > 0}
      <ul class="subjects">
        {#each n.subjects as s (s.id)}
          <li class="subject">
            <span class="subject-account">{s.accountPath}</span>
            <span class="money">
              <CurrencyPill code={s.currency} size="xs" />
              <span class="amount">{amt(s.amount)}</span>
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    {#each n.shares as sh (sh.id)}
      <div class="share">
        split with {tx.groupName ?? 'group'}
        <span class="share-amount">
          <CurrencyPill code={sh.currency} size="xs" />
          <span class="amount">{amt(sh.amount)}</span>
        </span>
      </div>
    {/each}

    {#if hasMovement}
      <div class="movement">
        <span class="movement-label">how it moved</span>
        <div class="movement-body">
          {#if n.movement.source}
            <span class="from">{n.movement.source.accountPath}</span>
          {/if}
          {#if n.movement.flow}
            <span class="flow">
              <CurrencyPill code={n.movement.flow.from.currency} size="xs" />
              <span class="amount">{n.movement.flow.from.amount}</span>
              <span class="arrow" aria-hidden="true">→</span>
              <CurrencyPill code={n.movement.flow.to.currency} size="xs" />
              <span class="amount">{n.movement.flow.to.amount}</span>
            </span>
          {/if}
          {#each n.movement.fees as fee (fee.id)}
            <span class="fee">
              fee
              <CurrencyPill code={fee.currency} size="xs" />
              <span class="amount">{amt(fee.amount)}</span>
            </span>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  /* Aqua-style gloss card (not the XP bevel) — flat panel on a soft drop shadow with a
     glossy top highlight and hairline border. See --card-* tokens / Card.svelte. */
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    padding: var(--sp-lg);
    min-width: min(22rem, 80vw);
    background: linear-gradient(180deg, var(--color-window-inset), var(--color-window));
    border: 1px solid var(--card-border-color);
    border-radius: var(--card-radius);
    box-shadow: var(--card-shadow);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-md);
    border-bottom: 1px solid var(--color-rule);
    padding-bottom: var(--sp-sm);
  }

  .desc {
    font-family: var(--font-serif);
    font-size: var(--text-base);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .date {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  /* --- Simple 2-leg line --- */
  .simple-line {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .simple-line .to {
    color: var(--color-text);
    font-weight: 700;
  }

  /* --- Subjects (lead) --- */
  .subjects {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
  }

  .subject {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-sm);
  }

  .subject-account {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* --- Share (Fish Pie) --- */
  .share {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-sm);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .share-amount {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  /* --- Movement (mechanical legs) --- */
  .movement {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
    padding-top: var(--sp-sm);
    border-top: 1px dotted var(--color-rule);
  }

  .movement-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .movement-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .from {
    color: var(--color-text-muted);
  }

  .flow,
  .fee {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .arrow {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .money {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .amount {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--color-text);
  }

  .movement-body .amount {
    color: var(--color-text-muted);
  }
</style>
