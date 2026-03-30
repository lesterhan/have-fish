<script lang="ts">
  import Modal from '$lib/components/Modal.svelte'
  import Button from '$lib/components/Button.svelte'
  import { toISODate } from '$lib/date'
  import type { Account } from '$lib/api'

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
    accounts: Account[]
    open: boolean
    onclose: () => void
  }

  let { tx, accounts, open = $bindable(), onclose }: Props = $props()

  let accountPaths = $derived(Object.fromEntries(accounts.map(a => [a.id, a.path])))

  let date = $derived(toISODate(new Date(tx.date)))

  // Balance per currency — must all be 0.00 to be valid
  let balances = $derived.by(() => {
    const map = new Map<string, number>()
    for (const p of tx.postings) {
      map.set(p.currency, (map.get(p.currency) ?? 0) + parseFloat(p.amount))
    }
    return map
  })

  let balanced = $derived([...balances.values()].every(v => Math.abs(v) < 0.005))

  function formatAmount(amount: string): string {
    const n = parseFloat(amount)
    return (n >= 0 ? '+' : '') + n.toFixed(2)
  }
</script>

<Modal title="Edit Transaction" {open} {onclose}>
  <div class="modal-body">
    <p class="hint">Click any field to edit</p>

    <div class="header-row">
      <span class="tx-date">{date}</span>
      <span class="tx-description">{tx.description ?? '—'}</span>
    </div>

    <div class="postings">
      {#each tx.postings as posting}
        <div class="posting-row">
          <span class="posting-account">{accountPaths[posting.accountId] ?? posting.accountId}</span>
          <span class="posting-amount">{formatAmount(posting.amount)} {posting.currency}</span>
        </div>
      {/each}
    </div>

    <hr class="divider" />

    <div class="balance-row">
      <span class="balance-label">Balance</span>
      {#if balanced}
        <span class="balance-ok">✓ 0.00</span>
      {:else}
        <div class="balance-errors">
          {#each [...balances.entries()] as [currency, total]}
            {#if Math.abs(total) >= 0.005}
              <span class="balance-bad" title="Balance must be zero">
                {total > 0 ? '+' : ''}{total.toFixed(2)} {currency}
              </span>
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    <div class="footer">
      <Button onclick={onclose}>Cancel</Button>
      <Button variant="primary" disabled>Save</Button>
    </div>
  </div>
</Modal>

<style>
  .modal-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    min-width: 420px;
  }

  .hint {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-disabled);
    margin: 0;
  }

  .header-row {
    display: flex;
    gap: var(--sp-md);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .tx-date {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .tx-description {
    color: var(--color-accent-mid);
    font-family: var(--font-sans);
    font-weight: bold;
  }

  .postings {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-left: var(--sp-lg);
  }

  .posting-row {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-lg);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .posting-account {
    color: var(--color-text);
  }

  .posting-amount {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .divider {
    border: none;
    border-top: 1px solid var(--color-divider);
    margin: 0;
  }

  .balance-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .balance-label {
    color: var(--color-text-muted);
  }

  .balance-ok {
    color: var(--color-success);
  }

  .balance-errors {
    display: flex;
    gap: var(--sp-sm);
  }

  .balance-bad {
    color: var(--color-danger);
  }

  .footer {
    display: flex;
    justify-content: space-between;
    padding-top: var(--sp-xs);
    border-top: 1px solid var(--color-divider);
  }
</style>
