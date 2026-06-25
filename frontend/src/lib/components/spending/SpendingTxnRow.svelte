<script lang="ts">
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import { headlineSubject, rowSource, stripRoot } from './spendingRow'
  import type { Transaction } from '$lib/api'

  interface Props {
    tx: Transaction
    idx: number
    converted: boolean
    fxRates: Record<string, number>
    baseCurrency: string
    onselect: (tx: Transaction) => void
  }

  let { tx, idx, converted, fxRates, baseCurrency, onselect }: Props = $props()

  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  // Headline = the meaningful subject leg (role-based, shared classifier). Falls back to the
  // first posting only for a degenerate shape with no subject (shouldn't reach the spend list).
  let mainPosting = $derived(headlineSubject(tx) ?? tx.postings[0])
  let sourcePosting = $derived(rowSource(tx))

  let expensePath = $derived(mainPosting ? stripRoot(mainPosting.accountPath) : '')
  let fromPath = $derived(sourcePosting ? stripRoot(sourcePosting.accountPath) : '')

  let d = $derived(new Date(tx.date.substring(0, 10) + 'T00:00:00'))
  let dayOfWeek = $derived(DAYS[d.getDay()])
  let dateLabel = $derived(`${d.getDate()} ${MONTHS[d.getMonth()]}`)

  let amount = $derived(mainPosting ? Math.abs(parseFloat(mainPosting.amount)) : 0)
  let postingCurrency = $derived(mainPosting?.currency ?? baseCurrency)

  let cadEquiv = $derived(
    (amount * (fxRates[postingCurrency] ?? 1)).toLocaleString('en-CA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  )

  function fmtAmount(n: number): string {
    return n.toLocaleString('en-CA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }
</script>

<button class="row" class:odd={idx % 2 !== 0} onclick={() => onselect(tx)} title="View transaction">
  <span class="col-date">
    <span class="day">{dayOfWeek}</span>
    <span class="date">{dateLabel}</span>
  </span>
  <span class="col-payee">
    <span class="payee">{tx.description ?? '—'}</span>
    {#if fromPath || expensePath}
      <span class="account-path">
        {#if fromPath}{fromPath}{/if}
        {#if fromPath && expensePath} → {/if}
        {expensePath}
      </span>
    {/if}
  </span>
  <span class="col-amount">
    <span class="amount-line">
      <CurrencyPill code={postingCurrency} size="xs" />
      <span class="amount-value">{fmtAmount(amount)}</span>
    </span>
    {#if converted && postingCurrency !== baseCurrency}
      <span class="converted-line">= {cadEquiv} {baseCurrency}</span>
    {/if}
  </span>
</button>

<style>
  .row {
    display: grid;
    grid-template-columns: 52px 1fr auto;
    gap: 10px;
    padding: 7px 14px;
    border: none;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window-raised);
    align-items: start;
    width: 100%;
    text-align: left;
    cursor: pointer;
    font: inherit;
    transition: background var(--duration-fast) var(--ease);
  }

  .row.odd {
    background: var(--color-window);
  }

  .row:hover {
    background: var(--color-accent-light);
  }

  .row:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .col-date {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
  }

  .day {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--color-text-muted);
    text-transform: uppercase;
  }

  .date {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    color: var(--color-text);
  }

  .col-payee {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .payee {
    font-family: var(--font-serif);
    font-size: 13px;
    font-weight: 400;
    color: var(--color-accent);
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-path {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .col-amount {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }

  .amount-line {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .amount-value {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--color-text);
  }

  .converted-line {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-accent);
  }
</style>
