<script lang="ts">
  interface Props {
    accountPath: string
    startingBalance: string
    startingCurrency: string
    startingDate: string
    hasOffsetAccount: boolean
    parserSkipped: boolean
    parserName: string
    mappingDate: string
    mappingAmount: string
    mappingDescription: string
    mappingSignColumn: string
    mappingSignNegativeValue: string
    isMultiCurrency: boolean
    submitError: string
  }

  let {
    accountPath,
    startingBalance,
    startingCurrency,
    startingDate,
    hasOffsetAccount,
    parserSkipped,
    parserName,
    mappingDate,
    mappingAmount,
    mappingDescription,
    mappingSignColumn,
    mappingSignNegativeValue,
    isMultiCurrency,
    submitError,
  }: Props = $props()
</script>

<div class="summary">
  <div class="summary-section">
    <h3 class="summary-heading">Account</h3>
    <div class="summary-row">
      <span class="summary-label">Path</span>
      <code class="summary-value">{accountPath.trim()}</code>
    </div>
    {#if startingBalance.trim()}
      <div class="summary-row">
        <span class="summary-label">Starting balance</span>
        <span class="summary-value"
          >{startingBalance.trim()} {startingCurrency}</span
        >
      </div>
      <div class="summary-row">
        <span class="summary-label">Balance date</span>
        <span class="summary-value">{startingDate}</span>
      </div>
      {#if !hasOffsetAccount}
        <p class="summary-warn">
          No offset account set — starting balance will be skipped. Set one in
          Settings.
        </p>
      {/if}
    {/if}
  </div>

  <div class="summary-section">
    <h3 class="summary-heading">CSV Parser</h3>
    {#if parserSkipped}
      <p class="summary-muted">No parser configured.</p>
    {:else}
      <div class="summary-row">
        <span class="summary-label">Name</span>
        <span class="summary-value">{parserName.trim()}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Date column</span>
        <code class="summary-value">{mappingDate}</code>
      </div>
      <div class="summary-row">
        <span class="summary-label">Amount column</span>
        <code class="summary-value">{mappingAmount}</code>
      </div>
      {#if mappingDescription}
        <div class="summary-row">
          <span class="summary-label">Description column</span>
          <code class="summary-value">{mappingDescription}</code>
        </div>
      {/if}
      {#if mappingSignColumn}
        <div class="summary-row">
          <span class="summary-label">Direction column</span>
          <code class="summary-value">{mappingSignColumn}</code>
        </div>
        {#if mappingSignNegativeValue}
          <div class="summary-row">
            <span class="summary-label">Negative value</span>
            <code class="summary-value">{mappingSignNegativeValue}</code>
          </div>
        {/if}
      {/if}
      {#if isMultiCurrency}
        <div class="summary-row">
          <span class="summary-label">Multi-currency</span>
          <span class="summary-value">Yes</span>
        </div>
      {/if}
    {/if}
  </div>

  {#if submitError}
    <p class="summary-error">{submitError}</p>
  {/if}
</div>

<style>
  .summary {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
  }

  .summary-section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .summary-heading {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    padding-bottom: var(--sp-xs);
    border-bottom: 1px solid var(--color-bevel-mid);
    margin-bottom: var(--sp-xs);
  }

  .summary-row {
    display: flex;
    gap: var(--sp-sm);
    font-size: var(--text-sm);
    align-items: baseline;
  }

  .summary-label {
    color: var(--color-text-muted);
    min-width: 9rem;
    text-align: right;
    flex-shrink: 0;
  }

  .summary-value {
    color: var(--color-text);
  }

  .summary-muted {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    font-style: italic;
  }

  .summary-warn {
    font-size: var(--text-sm);
    color: var(--color-amount-negative);
  }

  .summary-error {
    font-size: var(--text-sm);
    color: var(--color-amount-negative);
    background: var(--color-danger-light);
    padding: var(--sp-xs) var(--sp-sm);
    box-shadow: var(--shadow-sunken);
  }
</style>
