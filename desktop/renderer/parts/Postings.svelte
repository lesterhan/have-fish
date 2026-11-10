<script lang="ts">
  // A transaction's postings as text: a balance check per currency and Copy, then its day and
  // description and one line per posting, accounts and amounts in columns. The rules are in
  // `postings.ts`; Copy puts the same text on the system clipboard.
  import { copy } from '../../copy'
  import type { ListedTransaction } from '../../shared/commands'
  import { balancesOf, postingsOf, postingsText, rootAndRest, widthsOf } from '../postings'
  import Button from './Button.svelte'

  let { transaction }: { transaction: ListedTransaction } = $props()

  const words = copy.spends.card
  const postings = $derived(postingsOf(transaction.legs, words.missingAccount))
  const widths = $derived(widthsOf(postings))
  const balances = $derived(balancesOf(transaction.legs))
  let copied = $state(false)

  /** The spaces that line a posting's amount up with the rest. */
  const padOf = (posting: { account: string }) =>
    ' '.repeat(widths.account - posting.account.length)

  async function copyPostings() {
    const sent = await window.haveFish.invoke('clipboard.copy', {
      text: postingsText(transaction, words.missingAccount),
    })
    if (!sent.ok) return
    copied = true
    setTimeout(() => {
      copied = false
    }, 1400)
  }
</script>

<div class="postings">
  <div class="bar">
    <span class="checks">
      {#each balances as balance (balance.currency)}
        <span
          class="check"
          aria-label={balance.ok
            ? words.balanced(balance.currency)
            : words.unbalanced(balance.currency)}
        >
          <span aria-hidden="true">{balance.currency} {balance.ok ? '✓' : '✗'}</span>
        </span>
      {/each}
    </span>
    <Button variant="quiet" onclick={() => void copyPostings()}>
      {copied ? words.copied : words.copy}
    </Button>
  </div>
  <div class="text" aria-label={words.postings}>
    {#each postings as posting, i (i)}
      {@const at = rootAndRest(posting.account)}
      <span class="line"
        >{#if posting.path}<span class="root" data-root={at.root.replace(':', '')}
            >{at.root}</span
          >{at.rest}{:else}{at.root}{/if}{padOf(posting)}{'  '}{posting.amount.padStart(
          widths.amount,
        )} {posting.currency}</span
      >
    {/each}
  </div>
</div>

<style>
  .postings {
    margin-block-start: var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-control);
    overflow: hidden;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: var(--color-band);
  }

  .checks {
    display: flex;
    gap: var(--space-3);
    color: var(--color-muted);
    font-family: var(--font-code);
    font-size: var(--text-small);
  }

  .text {
    padding: var(--space-3);
    overflow-x: auto;
    font-family: var(--font-code);
    font-size: var(--text-small);
    line-height: 1.5;
  }

  .line {
    display: block;
    white-space: pre;
  }

  .root[data-root='assets'] {
    color: var(--color-assets);
  }

  .root[data-root='liabilities'] {
    color: var(--color-liabilities);
  }

  .root[data-root='expenses'] {
    color: var(--color-expenses);
  }

  .root[data-root='income'] {
    color: var(--color-income);
  }
</style>
