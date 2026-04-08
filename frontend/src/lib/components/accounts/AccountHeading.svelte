<script lang="ts">
  import { currencyFlag } from '$lib/currency'
  import type { Account } from '$lib/api'

  interface Props {
    account: Account
    balances?: { currency: string; amount: string }[]
  }

  let { account, balances }: Props = $props()

  function formatAmount(amount: string): string {
    const n = parseFloat(amount)
    if (isNaN(n)) return amount
    return new Intl.NumberFormat('en-CA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(n))
  }

  function isNegative(amount: string): boolean {
    return parseFloat(amount) < 0
  }
</script>

<header class="account-header">
  <div class="header-left">
    <h1 class="account-name">{account.name ?? account.path}</h1>
    <p class="account-path">{account.path}</p>
  </div>

  {#if balances && balances.length > 0}
    <div class="balance-block">
      <span class="balance-label">Current Balance</span>
      <div class="balance-amounts">
        {#each balances as b}
          <div class="balance-item">
            <span class="balance-currency">
              {currencyFlag(b.currency)
                ? `${currencyFlag(b.currency)} `
                : ''}{b.currency}
            </span>
            <span class="balance-amount">
              {isNegative(b.amount) ? '−' : ''}{formatAmount(b.amount)}
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</header>

<style>
  .account-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding: var(--sp-lg) var(--sp-xl);
    margin-bottom: var(--sp-xl);
    background: var(--color-window-raised);
    border-left: 4px solid var(--color-accent);
    border-bottom: 1px solid var(--color-border);
    gap: var(--sp-xl);
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
    min-width: 0;
  }

  .account-name {
    font-family: var(--font-serif);
    font-size: var(--text-3xl);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-path {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 0;
  }

  .balance-block {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }

  .balance-label {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .balance-amounts {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--sp-xs);
  }

  .balance-item {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    gap: var(--sp-sm);
  }

  .balance-currency {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .balance-amount {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }
</style>
