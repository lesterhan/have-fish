<script lang="ts">
  import MoneyDisplay from '$lib/components/ui/MoneyDisplay.svelte'
  import { type Account, type Transaction } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import {
    parseDateParts,
    summarize,
    classifyTransfer,
    fmt,
  } from './transactionUtils'

  interface Props {
    tx: Transaction
    accounts: Account[]
    defaultOffsetAccountId?: string | null
    defaultConversionAccountId?: string | null
    currentAccountId?: string | null
    selectable?: boolean
    selected?: boolean
    ontoggleselect?: (id: string) => void
    onselect?: (tx: Transaction) => void
  }

  let {
    tx,
    accounts,
    defaultOffsetAccountId,
    defaultConversionAccountId,
    currentAccountId = null,
    selectable = false,
    selected = false,
    ontoggleselect,
    onselect,
  }: Props = $props()

  // Row is read-only display now; editing lives in the page-level TransactionDetailModal,
  // opened by clicking the row (onselect). Display derives straight from the `tx` prop, so a
  // save reflects when the host swaps in the updated transaction.
  let accountPaths = $derived(
    Object.fromEntries(accounts.map((a) => [a.id, a.path])),
  )

  let dateParts = $derived(parseDateParts(tx.date))

  // A cross-currency transfer has postings in more than one currency.
  let isCrossCurrency = $derived(
    new Set(tx.postings.map((p) => p.currency)).size > 1,
  )

  let isTransfer = $derived.by(() => {
    const settings = settingsStore.value
    if (!settings) return false
    const expRoot = settings.defaultExpensesRootPath
    const toPath = accountPaths[to.accountId] ?? ''
    return !toPath.startsWith(`${expRoot}:`) && toPath !== expRoot
  })

  let transfer = $derived(
    classifyTransfer(tx.postings, defaultConversionAccountId),
  )
  let { from, to, rest } = $derived(summarize(tx.postings))

  // When viewing a specific account page, identify which side of the transaction
  // is the current account so we can suppress it and show only the other side.
  let currentIsFrom = $derived(
    currentAccountId !== null && from.accountId === currentAccountId,
  )
  let currentIsTo = $derived(
    currentAccountId !== null && to.accountId === currentAccountId,
  )
  let currentIsSource = $derived(
    currentAccountId !== null &&
      transfer.source?.accountId === currentAccountId,
  )
  let currentIsTarget = $derived(
    currentAccountId !== null &&
      transfer.target?.accountId === currentAccountId,
  )

  // When viewing a specific account, determine if money is flowing in or out.
  let flowDirection = $derived.by((): 'in' | 'out' | null => {
    if (!currentAccountId || !isTransfer) return null
    const posting = tx.postings.find((p) => p.accountId === currentAccountId)
    if (!posting) return null
    return parseFloat(posting.amount) > 0 ? 'in' : 'out'
  })
</script>

<!-- Role is always interactive (checkbox in select mode, button otherwise); static analysis
     can't prove it, so the tabindex warning is suppressed. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="row"
  class:transfer={isTransfer}
  class:selectable
  class:selected
  onclick={selectable ? () => ontoggleselect?.(tx.id) : () => onselect?.(tx)}
  role={selectable ? 'checkbox' : 'button'}
  aria-checked={selectable ? selected : undefined}
  tabindex="0"
  onkeydown={(e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      if (selectable) ontoggleselect?.(tx.id)
      else onselect?.(tx)
    }
  }}
>
  {#if selectable}
    <div class="select-col" aria-hidden="true">
      <span class="checkbox" class:checked={selected}></span>
    </div>
  {/if}

  <div class="date">
    <span class="date-meta">{dateParts.year} {dateParts.dow}</span>
    <span class="date-main">{dateParts.monthDay}</span>
  </div>

  <div class="body">
    <!-- Description -->
    <span class="description">{tx.description || '—'}</span>

    {#if isTransfer}
      <span class="transfer-tag">⇄ transfer</span>
    {/if}

    {#if isCrossCurrency}
      <!-- Cross-currency transfer -->
      <div class="summary-line">
        {#if currentIsSource}
          <!-- On the source account page: show only where money went -->
          <span class="arrow" aria-hidden="true">→</span>
          <span class="account account-to">
            {accountPaths[transfer.target?.accountId ?? ''] ??
              transfer.target?.accountId ??
              '—'}
          </span>
        {:else if currentIsTarget}
          <!-- On the target account page: show only where money came from -->
          <span class="account account-from account-from-transfer">
            {accountPaths[transfer.source.accountId] ??
              transfer.source.accountId}
          </span>
          <span class="arrow" aria-hidden="true">←</span>
        {:else}
          <!-- Full display (transactions page or current account not in source/target) -->
          <span class="account account-from account-from-transfer">
            {accountPaths[transfer.source.accountId] ??
              transfer.source.accountId}
          </span>
          <span class="arrow" aria-hidden="true">➜</span>
          <span class="account account-to">
            {accountPaths[transfer.target?.accountId ?? ''] ??
              transfer.target?.accountId ??
              '—'}
          </span>
        {/if}
      </div>
      {#if transfer.fees.length > 0}
        <div class="transfer-fees">
          {#each transfer.fees as fee}
            <span class="fee-label">
              fee {Math.abs(parseFloat(fee.amount)).toFixed(2)}
              {fee.currency}
            </span>
          {/each}
        </div>
      {/if}
    {:else}
      <!-- Standard summary line -->
      <div class="summary-line">
        {#if currentIsFrom}
          <!-- On the "from" account page: show only where money went -->
          <span class="arrow" aria-hidden="true">→</span>
          <span
            class="account account-to"
            class:account-uncategorized={to.accountId === defaultOffsetAccountId}
          >
            {accountPaths[to.accountId] ?? to.accountId}
          </span>
        {:else if currentIsTo}
          <!-- On the "to" account page: show only where money came from -->
          <span
            class="account account-from"
            class:account-uncategorized={from.accountId ===
              defaultOffsetAccountId}
          >
            {accountPaths[from.accountId] ?? from.accountId}
          </span>
          <span class="arrow" aria-hidden="true">←</span>
        {:else}
          <!-- Full display (transactions page or current account not in from/to) -->
          <span
            class="account account-from"
            class:account-uncategorized={from.accountId ===
              defaultOffsetAccountId}
          >
            {accountPaths[from.accountId] ?? from.accountId}
          </span>

          <span class="arrow" aria-hidden="true">➜</span>

          <span
            class="account account-to"
            class:account-uncategorized={to.accountId === defaultOffsetAccountId}
          >
            {accountPaths[to.accountId] ?? to.accountId}
          </span>
        {/if}
      </div>

      {#if rest.length > 0}
        <div class="transfer-fees">
          {#each rest as posting}
            <span class="fee-label"
              >fee {fmt(posting.amount)} {posting.currency}</span
            >
          {/each}
        </div>
      {/if}
    {/if}

  </div>

  <div class="money-col">
    {#if isCrossCurrency}
      <MoneyDisplay
        amount={fmt(transfer.source.amount)}
        currency={transfer.source.currency}
      />
      <span class="cross-arrow" aria-hidden="true">➜</span>
      <MoneyDisplay
        amount={fmt(transfer.target?.amount ?? '0')}
        currency={transfer.target?.currency ?? ''}
      />
    {:else if from.currency === to.currency}
      <MoneyDisplay
        amount={fmt(from.amount)}
        currency={to.currency}
        {flowDirection}
      />
    {:else}
      <MoneyDisplay amount={fmt(from.amount)} currency={from.currency} />
      <span class="cross-arrow" aria-hidden="true">→</span>
      <MoneyDisplay amount={fmt(to.amount)} currency={to.currency} />
    {/if}
  </div>

</div>

<style>
  .row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-rows: auto;
    align-items: start;
    gap: var(--sp-xs);
    padding: 7px 14px;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window-raised);
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast) var(--ease);
  }

  .row:nth-child(even) {
    background: var(--color-window);
  }

  .row:hover {
    background: var(--color-accent-light);
  }

  .row:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .row.selectable {
    grid-template-columns: auto auto 1fr;
  }

  .row.selected {
    background: var(--color-accent-light);
  }

  .select-col {
    display: flex;
    align-items: center;
    align-self: center;
    padding-top: 1px;
  }

  .checkbox {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid var(--color-rule);
    background: var(--color-window-inset);
    flex-shrink: 0;
    position: relative;
    transition:
      border-color var(--duration-fast) var(--ease),
      background var(--duration-fast) var(--ease);
  }

  .checkbox.checked {
    background: linear-gradient(
      180deg,
      var(--color-accent-mid),
      var(--color-accent)
    );
    border-color: var(--color-accent);
  }

  .checkbox.checked::after {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--color-accent-fg);
    opacity: 0.85;
  }

  .row:last-child {
    border-bottom: none;
  }

  .date {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .date-meta {
    font-size: 9px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .date-main {
    font-size: 10px;
    font-weight: 700;
    color: var(--color-text);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .transfer .account-to {
    color: var(--color-text-muted);
  }

  .transfer-tag {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    align-self: flex-start;
  }

  .description {
    font-family: var(--font-serif);
    font-size: 13px;
    color: var(--color-accent);
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .summary-line {
    font-family: var(--font-mono);
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .transfer-fees {
    display: flex;
    gap: var(--sp-sm);
  }

  .fee-label {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
  }

  .arrow {
    color: var(--color-text-muted);
    flex-shrink: 0;
    flex: 0 0 1.25rem;
    text-align: center;
  }

  .account {
    color: var(--color-text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .account-from {
    color: var(--color-text-muted);
  }

  .account-from-transfer {
    color: var(--color-text);
  }

  .account-to {
    color: var(--color-text);
  }

  .account-uncategorized {
    color: var(--color-warning);
  }

  .money-col {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    align-self: center;
    flex-shrink: 0;
  }

  .cross-arrow {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
  }

  @media (max-width: 520px) {
    .row {
      grid-template-columns: auto 1fr;
      grid-template-rows: auto auto;
      grid-template-areas:
        'date money'
        'body body';
      border-bottom: 2px solid var(--color-border);
      padding: var(--sp-xs) var(--sp-sm);
      gap: var(--sp-xs);
    }

    .row.selectable {
      grid-template-columns: auto auto 1fr;
      grid-template-areas:
        'sel date money'
        'sel body body';
    }

    .select-col {
      grid-area: sel;
      align-self: center;
    }

    .date {
      grid-area: date;
      flex-direction: row;
      align-items: baseline;
      gap: var(--sp-xs);
    }

    .date-main {
      font-size: var(--text-sm);
    }
    .date-meta {
      font-size: var(--text-xs);
    }

    .body {
      grid-area: body;
    }

    .money-col {
      grid-area: money;
      justify-self: end;
    }

    /* Make stacked MoneyDisplay render inline on mobile */
    .money-col :global(.money) {
      flex-direction: row;
      align-items: center;
      gap: var(--sp-xs);
    }

    .money-col :global(.money .amount) {
      font-size: var(--text-sm);
    }

    .summary-line {
      flex-wrap: wrap;
    }
  }
</style>
