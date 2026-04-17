<script lang="ts">
  import Panel from '$lib/components/ui/Panel.svelte'
  import Toggle from '$lib/components/ui/Toggle.svelte'
  import { currencyFlag } from '$lib/currency'
  import {
    fetchSpendingFxPairs,
    fetchFxRate,
    fetchSpendingConverted,
  } from '$lib/api'
  import type { SpendingSummary } from '$lib/api'

  interface Props {
    summary: SpendingSummary
    preferredCurrency: string
    from: string
    to: string
  }

  let { summary, preferredCurrency, from, to }: Props = $props()

  let converting = $state(false)
  let fetching = $state(false)
  let remaining = $state(0)
  let convertedTotal = $state<string | null>(null)

  // Absolute value for display — expenses are negative in the data model
  function abs(amount: string): string {
    const n = parseFloat(amount)
    return Math.abs(n).toFixed(2)
  }

  function formatAmount(amount: string): string {
    const n = Math.abs(parseFloat(amount))
    return n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  async function startConversion() {
    fetching = true
    convertedTotal = null

    const { pairs } = await fetchSpendingFxPairs(from, to, preferredCurrency)
    const missing = pairs.filter((p) => !p.cached)
    remaining = missing.length

    if (missing.length > 0) {
      await Promise.all(
        missing.map(async (pair) => {
          await fetchFxRate(pair.date, pair.from, pair.to)
          remaining -= 1
        })
      )
    }

    const result = await fetchSpendingConverted(from, to, preferredCurrency)
    convertedTotal = result.total
    fetching = false
  }

  async function handleToggle() {
    if (!converting) {
      converting = true
      await startConversion()
    } else {
      converting = false
      convertedTotal = null
      fetching = false
      remaining = 0
    }
  }

  // Re-run conversion when month changes (from/to change) if toggle is on
  $effect(() => {
    // Depend on from/to
    from; to
    if (converting) {
      convertedTotal = null
      startConversion()
    }
  })

  let currencies = $derived(Object.entries(summary.total))
  let flag = $derived(currencyFlag(preferredCurrency))
  let needsConversion = $derived(
    currencies.some(([c]) => c !== preferredCurrency)
  )
</script>

<Panel title="Monthly Summary">
  <div class="summary-body">
    <div class="totals-row">
      {#each currencies as [currency, amount]}
        <div class="currency-chip">
          <span class="chip-currency">{currencyFlag(currency) ? `${currencyFlag(currency)} ` : ''}{currency}</span>
          <span class="chip-amount">{formatAmount(amount)}</span>
        </div>
      {/each}
    </div>

    {#if needsConversion}
      <div class="convert-row">
        <div class="convert-toggle">
          <Toggle
            bind:checked={converting}
            label="Convert to {flag ? `${flag} ` : ''}{preferredCurrency}"
            disabled={fetching}
          />
        </div>

        {#if converting}
          {#if fetching}
            <div class="fetch-status">
              <span class="spinner" aria-label="Loading"></span>
              {#if remaining > 0}
                <span class="fetch-label">Fetching {remaining} rate{remaining === 1 ? '' : 's'}…</span>
              {:else}
                <span class="fetch-label">Converting…</span>
              {/if}
            </div>
          {:else if convertedTotal !== null}
            <div class="converted-total">
              <span class="converted-label">{flag ? `${flag} ` : ''}{preferredCurrency}</span>
              <span class="converted-amount">{formatAmount(convertedTotal)}</span>
            </div>
          {:else}
            <span class="fetch-label muted">Unavailable — some rates missing</span>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</Panel>

<style>
  .summary-body {
    padding: var(--sp-md);
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
  }

  /* Per-currency totals */
  .totals-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-sm);
  }

  .currency-chip {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-raised);
    box-shadow: var(--shadow-sunken);
    min-width: 96px;
  }

  .chip-currency {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .chip-amount {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    color: var(--color-amount-negative);
    font-weight: var(--weight-semibold);
  }

  /* Convert row */
  .convert-row {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    flex-wrap: wrap;
    padding-top: var(--sp-sm);
    border-top: 1px solid var(--color-divider);
  }

  .convert-toggle {
    flex-shrink: 0;
  }

  /* Spinner */
  .fetch-status {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--color-text-muted);
    border-top-color: var(--color-text);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .fetch-label {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    font-family: var(--font-sans);
  }

  .fetch-label.muted {
    color: var(--color-warning);
  }

  /* Converted total */
  .converted-total {
    display: flex;
    align-items: baseline;
    gap: var(--sp-xs);
  }

  .converted-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .converted-amount {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    color: var(--color-amount-negative);
  }
</style>
