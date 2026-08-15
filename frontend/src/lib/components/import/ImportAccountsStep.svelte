<script lang="ts">
  import AccountPicker from '$lib/components/accounts/AccountPicker.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import type { Account } from '$lib/api'
  import { suggestedPathForCurrency } from './import-helpers'

  interface Props {
    // Currencies this import needs an account for, in first-seen order. Empty for a
    // single-currency import, which asks the same question once as `singleLabel` below.
    currencies: string[]
    // Currency code → account id. Owned by the caller and bound, because it is the
    // mapping the commit actually posts against.
    currencyAccounts: Record<string, string>
    // The one account a single-currency import posts to. Ignored when `currencies` is set.
    fromAccountId: string
    isMultiCurrency: boolean
    accounts: Account[]
    // Root path of the parser's default account, used only to suggest a path to create.
    rootPath: string | null
    onaccountcreated: (account: Account) => void
    oncontinue: () => void
    onback: () => void
  }

  let {
    currencies,
    currencyAccounts = $bindable(),
    fromAccountId = $bindable(),
    isMultiCurrency,
    accounts,
    rootPath,
    onaccountcreated,
    oncontinue,
    onback,
  }: Props = $props()

  // Rows cannot be assigned to accounts that don't exist, so deferring this would only
  // relocate the same blocker to commit time — where it currently surfaces as a failure
  // rather than as the setup task it is.
  let unmapped = $derived(
    isMultiCurrency
      ? currencies.filter((c) => !currencyAccounts[c])
      : fromAccountId
        ? []
        : ['account'],
  )

  function accountPath(id: string): string {
    return accounts.find((a) => a.id === id)?.path ?? ''
  }

  // Whether this row is still sitting on the path-convention suggestion, as opposed to an
  // account the user picked. Only affects the row's label.
  function isSuggested(currency: string): boolean {
    const path = accountPath(currencyAccounts[currency])
    return !!path && path === suggestedPathForCurrency(rootPath, currency)
  }
</script>

<div class="accounts-step">
  <div class="intro">
    <h2>Where does this money live?</h2>
    <p>
      {#if isMultiCurrency}
        This file holds {currencies.length} currenc{currencies.length === 1 ? 'y' : 'ies'}.
        Each needs an account. The suggestion follows your account naming, but you can point
        a currency anywhere — including at an account that doesn't match the pattern.
      {:else}
        Every row in this file posts to one account.
      {/if}
    </p>
  </div>

  <div class="rows">
    {#if isMultiCurrency}
      {#each currencies as currency (currency)}
        <div class="row" class:unmapped={!currencyAccounts[currency]}>
          <span class="currency">{currency}</span>
          <span class="arrow" aria-hidden="true"><Icon name="arrow-right" size={11} /></span>
          <div class="picker">
            <AccountPicker
              {accounts}
              bind:value={currencyAccounts[currency]}
              placeholder={suggestedPathForCurrency(rootPath, currency) || 'Select or create…'}
              createCurrency={currency}
              oncreate={onaccountcreated}
            />
          </div>
          <span class="status">
            {#if !currencyAccounts[currency]}
              <span class="status-needed">needs an account</span>
            {:else if isSuggested(currency)}
              <span class="status-ok">matches your naming</span>
            {:else}
              <span class="status-custom">custom</span>
            {/if}
          </span>
        </div>
      {/each}
    {:else}
      <div class="row" class:unmapped={!fromAccountId}>
        <span class="currency">Account</span>
        <span class="arrow" aria-hidden="true"><Icon name="arrow-right" size={11} /></span>
        <div class="picker">
          <AccountPicker
            {accounts}
            bind:value={fromAccountId}
            placeholder="Select or create an account…"
            oncreate={onaccountcreated}
          />
        </div>
        <span class="status">
          {#if !fromAccountId}<span class="status-needed">required</span>{/if}
        </span>
      </div>
    {/if}
  </div>

  <div class="actions">
    <GradientButton onclick={onback}>Back</GradientButton>
    <GradientButton size="lg" active disabled={unmapped.length > 0} onclick={oncontinue}>
      {unmapped.length > 0
        ? `${unmapped.length} still to map`
        : 'Continue to review'}
    </GradientButton>
  </div>
</div>

<style>
  .accounts-step {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    padding: var(--sp-md);
  }

  .intro h2 {
    margin: 0 0 var(--sp-xs);
    font-family: var(--font-serif);
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .intro p {
    margin: 0;
    max-width: 48rem;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .rows {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    background: var(--color-window-raised);
    box-shadow: var(--shadow-inset);
    overflow: hidden;
  }

  .row {
    display: grid;
    grid-template-columns: 5rem auto minmax(12rem, 32rem) 1fr;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-md);
    border-bottom: 1px solid var(--color-rule);
  }

  .row:last-child {
    border-bottom: none;
  }

  .currency {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .arrow {
    display: inline-flex;
    color: var(--color-text-muted);
  }

  .status {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .status-needed {
    color: var(--color-amount-negative);
  }

  .status-ok,
  .status-custom {
    color: var(--color-text-muted);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-sm);
  }
</style>
