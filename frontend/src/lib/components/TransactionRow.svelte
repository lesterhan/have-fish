<script lang="ts">
  import Button from '$lib/components/Button.svelte'
  import { toISODate } from '$lib/date'

  // The shape returned by GET /api/transactions
  interface Posting {
    id: string
    accountId: string
    amount: string
    currency: string
  }

  interface Transaction {
    id: string
    date: string
    description: string | null
    postings: Posting[]
  }

  interface Props {
    tx: Transaction
    accountPaths: Record<string, string>
  }

  let { tx, accountPaths }: Props = $props()

  // Split postings into the two "main" accounts (from + to) and any extras (fees, adjustments).
  // "from" = the most negative posting, "to" = the most positive.
  // For same-currency this is unambiguous. For cross-currency (forex transfers) the
  // two asset postings will be the only negative and positive ones; fees show as extras.
  function summarize(postings: Posting[]): {
    from: Posting
    to: Posting
    rest: Posting[]
  } {
    const sorted = [...postings].sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))
    return {
      from: sorted[0],
      to: sorted[sorted.length - 1],
      rest: sorted.slice(1, -1),
    }
  }

  // Format the summary amount string.
  // Same currency: "50.25 CAD"
  // Cross-currency: "100.00 CAD → 57.25 GBP"
  function formatAmounts(from: Posting, to: Posting): string {
    const fromAmt = Math.abs(parseFloat(from.amount)).toFixed(2)
    if (from.currency === to.currency) {
      return `${fromAmt} ${to.currency}`
    }
    const toAmt = parseFloat(to.amount).toFixed(2)
    return `${fromAmt} ${from.currency} → ${toAmt} ${to.currency}`
  }

  let { from, to, rest } = $derived(summarize(tx.postings))
  let amounts = $derived(formatAmounts(from, to))
  let fromPath = $derived(accountPaths[from.accountId] ?? from.accountId)
  let toPath = $derived(accountPaths[to.accountId] ?? to.accountId)
</script>

<div class="row">
  <span class="date">{toISODate(new Date(tx.date))}</span>

  <div class="body">
    <span class="description">{tx.description ?? ''}</span>

    <div class="summary-line">
      <span class="account">{fromPath}</span>
      <span class="arrow">→</span>
      <span class="account">{toPath}</span>
      <span class="amounts">{amounts}</span>
    </div>

    {#each rest as posting}
      <div class="extra-posting">
        <span class="account">{accountPaths[posting.accountId] ?? posting.accountId}</span>
        <span class="amounts">{Math.abs(parseFloat(posting.amount)).toFixed(2)} {posting.currency}</span>
      </div>
    {/each}
  </div>

  <div class="actions">
    <Button disabled>Edit</Button>
  </div>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 6rem 1fr auto;
    align-items: start;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-bevel-mid);
    transition: background var(--duration-fast) var(--ease);
  }

  .row:hover {
    background: var(--color-accent-light);
  }

  .row:last-child {
    border-bottom: none;
  }

  .date {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding-top: 2px; /* optical align with description */
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .description {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .summary-line {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    display: flex;
    align-items: baseline;
    gap: var(--sp-xs);
  }

  .arrow {
    color: var(--color-text-disabled);
  }

  .account {
    color: var(--color-text);
  }

  .amounts {
    margin-left: auto;
    color: var(--color-text-muted);
  }

  .extra-posting {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    display: flex;
    gap: var(--sp-xs);
    padding-left: var(--sp-md);
  }

  .actions {
    display: flex;
    align-items: center;
  }
</style>
