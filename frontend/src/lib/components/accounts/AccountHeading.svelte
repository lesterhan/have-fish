<script lang="ts">
  import CurrencyPill from '../ui/CurrencyPill.svelte'
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
      {#each balances as b}
        <div class="balance-item">
          <span class="balance-label">BALANCE</span>
          <span class="balance-amount">
            <CurrencyPill code={b.currency} />
            {isNegative(b.amount) ? '−' : ''}{formatAmount(b.amount)}</span
          >
        </div>
      {/each}
    </div>
  {/if}
</header>

<style>
  .account-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 22px 10px;
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule);
    gap: var(--sp-xl);
    flex-shrink: 0;
  }

  @media (max-width: 520px) {
    .account-header {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--sp-sm);
      padding: var(--sp-md);
    }
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .account-name {
    font-family: var(--font-serif);
    font-size: 24px;
    font-weight: 600;
    color: var(--color-text);
    line-height: var(--leading-tight);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.2px;
  }

  @media (max-width: 520px) {
    .account-name {
      white-space: normal;
      font-size: var(--text-xl);
    }
  }

  .account-path {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    letter-spacing: 0.04em;
    margin: 0;
  }

  .balance-block {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--sp-lg);
    flex-shrink: 0;
  }

  @media (max-width: 520px) {
    .balance-block {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--sp-sm);
    }
  }

  .balance-item {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .balance-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--color-accent);
  }

  .balance-amount {
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 600;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }
</style>
