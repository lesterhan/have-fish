<script lang="ts">
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import type { Transaction, Account } from '$lib/api'

  interface Props {
    tx: Transaction
    idx: number
    converted: boolean
    fxRates: Record<string, number>
    baseCurrency: string
    accounts: Account[]
  }

  let { tx, idx, converted, fxRates, baseCurrency, accounts }: Props = $props()

  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  function accountPath(accountId: string): string {
    return accounts.find((a) => a.id === accountId)?.path ?? ''
  }

  let mainPosting = $derived(
    tx.postings.find((p) => accountPath(p.accountId).startsWith('expenses:')) ?? tx.postings[0],
  )

  let fromPosting = $derived(
    tx.postings.find((p) => accountPath(p.accountId).startsWith('assets:')),
  )

  let expensePath = $derived(
    mainPosting ? accountPath(mainPosting.accountId).split(':').slice(1).join(':') : '',
  )

  let fromPath = $derived(
    fromPosting ? accountPath(fromPosting.accountId).split(':').slice(1).join(':') : '',
  )

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

<div class="row" class:odd={idx % 2 !== 0}>
  <div class="col-date">
    <span class="day">{dayOfWeek}</span>
    <span class="date">{dateLabel}</span>
  </div>
  <div class="col-payee">
    <span class="payee">{tx.description ?? '—'}</span>
    {#if fromPath || expensePath}
      <span class="account-path">
        {#if fromPath}{fromPath}{/if}
        {#if fromPath && expensePath} → {/if}
        {expensePath}
      </span>
    {/if}
  </div>
  <div class="col-amount">
    <div class="amount-line">
      <CurrencyPill code={postingCurrency} size="xs" />
      <span class="amount-value">{fmtAmount(amount)}</span>
    </div>
    {#if converted && postingCurrency !== baseCurrency}
      <span class="converted-line">= {cadEquiv} {baseCurrency}</span>
    {/if}
  </div>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 52px 1fr auto;
    gap: 10px;
    padding: 7px 14px;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window-raised);
    align-items: start;
  }

  .row.odd {
    background: var(--color-window);
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
    font-size: 13px;
    font-weight: 600;
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
