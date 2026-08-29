<script lang="ts">
  import { onMount } from 'svelte'
  import Chip from '$lib/components/ui/Chip.svelte'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import Shimmer from '$lib/components/ui/Shimmer.svelte'
  import { fetchTransactions } from '$lib/api'
  import { formatCents } from '$lib/money'
  import { attentionChip } from '$lib/components/transactions/attentionChip'
  import {
    RECENT_ENTRIES,
    entryLines,
    type EntryLine,
    type EntryMatch,
  } from './accountEntries'

  /**
   * What a row looks like from the inside: the last few entries, what is unfinished, and
   * where to go next.
   *
   * This absorbs the manage page's right-hand transaction preview, and it is the reason the
   * account page stops being mandatory — "is this the account I meant, and is anything stuck
   * in it" is answerable from the table now. It is deliberately not a ledger: five lines, no
   * paging, no editing. Anything more is a trip to the account page, which the drawer links.
   */
  interface Props {
    /** By id for a real account, by path prefix for a category standing for its subtree. */
    match: EntryMatch
    /** The row's full path — the "see everything" link filters on it. */
    path: string
    /** Present for a real account row; null for a virtual path segment. */
    accountId: string | null
    /** Counterparty paths are shortened against this, so the common root is not repeated. */
    root?: string
    /** From `actionRequiredStore`; null while the summary is still loading. */
    attention?: number | null
    /** Offer the import hand-off. Off for categories, which a statement is never about. */
    canImport?: boolean
  }

  let {
    match,
    path,
    accountId,
    root = '',
    attention = null,
    canImport = false,
  }: Props = $props()

  let lines = $state<EntryLine[] | null>(null)
  let total = $state(0)
  let failed = $state(false)

  // Fetched on open rather than with the table: the drawer is one row at a time, and the
  // page would otherwise pull every transaction in the ledger to show five of them.
  onMount(async () => {
    try {
      const transactions =
        match.kind === 'account'
          ? await fetchTransactions({ accountId: match.accountId })
          : await fetchTransactions({ accountPath: match.path })
      total = transactions.length
      lines = entryLines(transactions, match, { root })
    } catch {
      failed = true
      lines = []
    }
  })

  let chip = $derived(attentionChip(attention))

  // The account page carries the attention filter; a category has no page of its own, so its
  // unfinished entries are shown where every transaction filter already lives.
  let attentionHref = $derived(
    accountId && match.kind === 'account'
      ? `/account/${accountId}`
      : `/transactions?accountPath=${encodeURIComponent(path)}`,
  )

  let allHref = $derived(
    `/transactions?accountPath=${encodeURIComponent(path)}`,
  )
</script>

<div class="drawer">
  {#if lines === null}
    <div class="loading">
      {#each { length: 3 } as _}
        <Shimmer height="1rem" />
      {/each}
    </div>
  {:else if failed}
    <p class="empty">Could not load recent entries.</p>
  {:else if lines.length === 0}
    <p class="empty">Nothing has been posted here yet.</p>
  {:else}
    <ul class="entries">
      {#each lines as line (line.id)}
        <li class="entry">
          <span class="when">{line.date}</span>
          <span class="what">
            <span class="description">{line.description}</span>
            {#if line.counterparty}
              <span class="other">{line.counterparty}</span>
            {/if}
          </span>
          <span class="amount" class:negative={line.cents < 0}>
            <CurrencyPill code={line.currency} size="xs" />
            {formatCents(line.cents)}
            {#if line.mixedCurrency}
              <span
                class="partial"
                title="This entry also moved another currency in this account — only the {line.currency} side is shown"
                >+ fx</span
              >
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="actions">
    {#if chip.show}
      <a class="attention" href={attentionHref}>
        <Chip size="xs" icon="warning">{chip.label}</Chip>
      </a>
    {/if}

    {#if lines !== null && total > 0}
      <a class="link" href={allHref}>
        {total > RECENT_ENTRIES
          ? `See all ${total} entries`
          : 'See these in Transactions'}
        <Icon name="arrow-right" size={11} />
      </a>
    {/if}

    {#if accountId}
      <a class="link" href="/account/{accountId}">
        Open account
        <Icon name="arrow-right" size={11} />
      </a>
      {#if canImport}
        <a class="link" href="/import?account={encodeURIComponent(accountId)}">
          Import a statement
          <Icon name="arrow-right" size={11} />
        </a>
      {/if}
    {/if}
  </div>
</div>

<style>
  .drawer {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-md);
    background: var(--color-window-raised);
    border-left: 3px solid var(--color-accent-mid);
  }

  .loading {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .empty {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .entry {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: baseline;
    gap: var(--sp-sm);
    padding: 2px 0;
    font-size: var(--text-xs);
  }

  .when {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .what {
    display: flex;
    align-items: baseline;
    gap: var(--sp-xs);
    min-width: 0;
  }

  .description {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .other {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .amount {
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .amount.negative {
    color: var(--color-amount-negative);
  }

  .partial {
    color: var(--color-text-muted);
    font-style: italic;
  }

  .actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-md);
  }

  .attention {
    text-decoration: none;
  }

  .link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--text-xs);
    color: var(--color-accent);
    text-decoration: none;
  }

  .link:hover {
    text-decoration: underline;
  }

  .link:focus-visible,
  .attention:focus-visible {
    outline: 2px solid var(--color-accent-mid);
  }
</style>
