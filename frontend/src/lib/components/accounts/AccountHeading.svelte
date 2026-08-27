<script lang="ts">
  import type { Account } from '$lib/api'
  import { balanceLabel } from './balanceLabel'

  interface Props {
    account: Account
    balances?: { currency: string; amount: string }[]
  }

  let { account, balances }: Props = $props()

  // The balance is the number you opened the page for, so it wins by size rather than by
  // colour, and the direction rides in the label instead of a leading minus sign.
  let items = $derived(
    (balances ?? []).map((b) => ({
      currency: b.currency,
      ...balanceLabel(account.resolvedType, b.amount, b.currency),
    })),
  )
</script>

<header class="account-header">
  <div class="header-left">
    <h1 class="account-name">{account.name ?? account.path}</h1>
    <p class="account-path">{account.path}</p>
  </div>

  {#if items.length > 0}
    <div class="balance-block">
      {#each items as item (item.currency)}
        <div class="balance-item">
          <span class="balance-label">{item.label}</span>
          <span class="balance-amount">{item.display}</span>
        </div>
      {/each}
    </div>
  {/if}
</header>

<style>
  .account-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
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
    font-size: 22px;
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
    align-items: flex-end;
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
    gap: 1px;
  }

  @media (max-width: 520px) {
    .balance-item {
      align-items: flex-start;
    }
  }

  /* Muted, not accent: the accent is for structure and focus, never for a label. The
     currency code lives here so a multi-currency account still names each figure without
     a pill competing with a 30px number. */
  .balance-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .balance-amount {
    font-family: var(--font-mono);
    font-size: 30px;
    font-weight: var(--weight-semibold);
    line-height: 1.05;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 520px) {
    .balance-amount {
      font-size: 22px;
    }
  }
</style>
