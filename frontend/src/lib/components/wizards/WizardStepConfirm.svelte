<script lang="ts">
  import { copy } from '$lib/copy'

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
    <h3 class="summary-heading">{copy.import.parser.summary.account}</h3>
    <div class="summary-row">
      <span class="summary-label">{copy.import.parser.summary.path}</span>
      <code class="summary-value">{accountPath.trim()}</code>
    </div>
    {#if startingBalance.trim()}
      <div class="summary-row">
        <span class="summary-label"
          >{copy.import.parser.summary.startingBalance}</span
        >
        <span class="summary-value"
          >{startingBalance.trim()} {startingCurrency}</span
        >
      </div>
      <div class="summary-row">
        <span class="summary-label"
          >{copy.import.parser.summary.balanceDate}</span
        >
        <span class="summary-value">{startingDate}</span>
      </div>
      {#if !hasOffsetAccount}
        <p class="summary-warn">
          {copy.import.parser.summary.noOffset}
        </p>
      {/if}
    {/if}
  </div>

  <div class="summary-section">
    <h3 class="summary-heading">{copy.import.parser.summary.parser}</h3>
    {#if parserSkipped}
      <p class="summary-muted">{copy.import.parser.summary.none}</p>
    {:else}
      <div class="summary-row">
        <span class="summary-label">{copy.import.parser.summary.name}</span>
        <span class="summary-value">{parserName.trim()}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">{copy.import.parser.summary.date}</span>
        <code class="summary-value">{mappingDate}</code>
      </div>
      <div class="summary-row">
        <span class="summary-label">{copy.import.parser.summary.amount}</span>
        <code class="summary-value">{mappingAmount}</code>
      </div>
      {#if mappingDescription}
        <div class="summary-row">
          <span class="summary-label"
            >{copy.import.parser.summary.description}</span
          >
          <code class="summary-value">{mappingDescription}</code>
        </div>
      {/if}
      {#if mappingSignColumn}
        <div class="summary-row">
          <span class="summary-label"
            >{copy.import.parser.summary.direction}</span
          >
          <code class="summary-value">{mappingSignColumn}</code>
        </div>
        {#if mappingSignNegativeValue}
          <div class="summary-row">
            <span class="summary-label"
              >{copy.import.parser.summary.negativeValue}</span
            >
            <code class="summary-value">{mappingSignNegativeValue}</code>
          </div>
        {/if}
      {/if}
      {#if isMultiCurrency}
        <div class="summary-row">
          <span class="summary-label"
            >{copy.import.parser.summary.multiCurrency}</span
          >
          <span class="summary-value">{copy.import.parser.summary.yes}</span>
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
    font-family: var(--font-mono);
    font-size: var(--text-label);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--color-text-muted);
    padding-bottom: var(--sp-xs);
    border-bottom: 1px solid var(--color-rule);
    margin-bottom: var(--sp-xs);
  }

  .summary-row {
    display: flex;
    gap: var(--sp-sm);
    font-size: var(--text-body);
    align-items: baseline;
  }

  .summary-label {
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--color-text-muted);
    min-width: 9rem;
    text-align: right;
    flex-shrink: 0;
  }

  .summary-value {
    color: var(--color-text);
  }

  .summary-muted {
    font-size: var(--text-body);
    color: var(--color-text-muted);
    font-style: italic;
  }

  .summary-warn {
    font-size: var(--text-body);
    color: var(--color-warning);
  }

  .summary-error {
    font-size: var(--text-body);
    color: var(--color-danger);
    background: var(--color-danger-light);
    padding: var(--sp-xs) var(--sp-sm);
  }
</style>
