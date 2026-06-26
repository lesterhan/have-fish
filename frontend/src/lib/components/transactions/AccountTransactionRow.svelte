<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte'
  import { type Account, type Transaction } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import MoneyDisplay from '$lib/components/ui/MoneyDisplay.svelte'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import {
    parseDateParts,
    summarize,
    classifyTransfer,
    fmt,
  } from './transactionUtils'

  interface Props {
    tx: Transaction
    idx: number
    accounts: Account[]
    currentAccountId: string
    defaultOffsetAccountId?: string | null
    defaultConversionAccountId?: string | null
    convertFx?: boolean
    preferredCurrency?: string
    fxRateMap?: Map<string, string | null>
    onselect?: (tx: Transaction) => void
  }

  let {
    tx,
    idx,
    accounts,
    currentAccountId,
    defaultOffsetAccountId,
    defaultConversionAccountId,
    convertFx = false,
    preferredCurrency = 'CAD',
    fxRateMap = new Map(),
    onselect,
  }: Props = $props()

  // Row is read-only display now; editing lives in the page-level TransactionDetailModal,
  // opened by clicking the row (onselect). Display derives straight from the `tx` prop.
  let accountPaths = $derived(
    Object.fromEntries(accounts.map((a) => [a.id, a.path])),
  )

  let dateParts = $derived(parseDateParts(tx.date))

  // --- Transaction classification ---
  let isCrossCurrency = $derived(
    new Set(tx.postings.map((p) => p.currency)).size > 1,
  )

  let { from, to, rest } = $derived(summarize(tx.postings))

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

  // Which side of the transaction is the current account?
  let currentIsFrom = $derived(from.accountId === currentAccountId)
  let currentIsTo = $derived(to.accountId === currentAccountId)
  let currentIsSource = $derived(
    transfer.source?.accountId === currentAccountId,
  )
  let currentIsTarget = $derived(
    transfer.target?.accountId === currentAccountId,
  )

  // Flow direction only applies to transfers — regular expenses get no directional styling.
  let flowDirection = $derived.by((): 'in' | 'out' | null => {
    if (!isTransfer) return null
    const posting = tx.postings.find((p) => p.accountId === currentAccountId)
    if (!posting) return null
    return parseFloat(posting.amount) > 0 ? 'in' : 'out'
  })

  // Amount values for the current account's perspective.
  let currentPosting = $derived(
    tx.postings.find((p) => p.accountId === currentAccountId),
  )

  // FX conversion — only for simple (non-cross-currency) postings in a foreign currency.
  let fxConverted = $derived.by(() => {
    if (!convertFx || isCrossCurrency || !currentPosting) return null
    if (currentPosting.currency === preferredCurrency) return null
    const date = tx.date.substring(0, 10)
    const key = `${date}::${currentPosting.currency}`
    if (!fxRateMap.has(key)) return { status: 'loading' as const }
    const rate = fxRateMap.get(key) ?? null
    if (rate === null)
      return { status: 'missing' as const, currency: currentPosting.currency }
    const converted = (
      parseFloat(currentPosting.amount) * parseFloat(rate)
    ).toFixed(2)
    return {
      status: 'ok' as const,
      convertedAmount: converted,
      originalCurrency: currentPosting.currency,
    }
  })
</script>

<div
  class="row"
  class:transfer={isTransfer}
  class:odd={idx % 2 !== 0}
  role="button"
  tabindex="0"
  onclick={() => onselect?.(tx)}
  onkeydown={(e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      onselect?.(tx)
    }
  }}
>
  <!-- Date -->
  <div class="date">
    <span class="date-meta">{dateParts.year} {dateParts.dow}</span>
    <span class="date-main">{dateParts.monthDay}</span>
  </div>

  <!-- Description -->
  <div class="desc-cell">
    <span class="description">{tx.description || '—'}</span>
    {#if isTransfer}<span class="transfer-tag">⇄</span>{/if}
  </div>

  <!-- Account (counterpart only — current account is suppressed) -->
  <div class="account-cell">
    {#if isCrossCurrency}
      {#if currentIsSource}
        <span class="dir-arrow flow-out">→</span>
        <span class="account"
          >{accountPaths[transfer.target?.accountId ?? ''] ??
            transfer.target?.accountId ??
            '—'}</span
        >
      {:else if currentIsTarget}
        <span class="dir-arrow flow-in">←</span>
        <span class="account"
          >{accountPaths[transfer.source.accountId] ??
            transfer.source.accountId}</span
        >
      {:else}
        <span class="account"
          >{accountPaths[transfer.source.accountId] ??
            transfer.source.accountId}</span
        >
        <span class="dir-arrow">➜</span>
        <span class="account"
          >{accountPaths[transfer.target?.accountId ?? ''] ??
            transfer.target?.accountId ??
            '—'}</span
        >
      {/if}
    {:else if currentIsFrom}
      <span
        class="dir-arrow"
        class:flow-in={isTransfer && flowDirection === 'in'}
        class:flow-out={isTransfer && flowDirection === 'out'}
      >
        ➜</span
      >
      <span
        class="account"
        class:account-uncategorized={to.accountId === defaultOffsetAccountId}
        >{accountPaths[to.accountId] ?? to.accountId}</span
      >
    {:else if currentIsTo}
      <span
        class="dir-arrow"
        class:flow-in={isTransfer && flowDirection === 'in'}
        class:flow-out={isTransfer && flowDirection === 'out'}
      >
        ↩</span
      >
      <span
        class="account"
        class:account-uncategorized={from.accountId === defaultOffsetAccountId}
        >{accountPaths[from.accountId] ?? from.accountId}</span
      >
    {:else}
      <!-- Fallback: current account not found in from/to (edge case) -->
      <span class="account"
        >{accountPaths[from.accountId] ?? from.accountId}</span
      >
      <span class="dir-arrow">➜</span>
      <span class="account">{accountPaths[to.accountId] ?? to.accountId}</span>
    {/if}
    {#if isCrossCurrency && transfer.fees.length > 0}
      <span class="fees">
        {#each transfer.fees as fee}<Icon name="coin" size={10} />{fmt(
            fee.amount,
          )}
          {fee.currency}{/each}
      </span>
    {:else if isTransfer && !isCrossCurrency && rest.length > 0}
      <span class="fees">
        {#each rest as fee}<Icon name="coin" size={10} />{fmt(fee.amount)}
          {fee.currency}{/each}
      </span>
    {/if}
  </div>

  <!-- Amount -->
  <div class="amount-cell">
    {#if isCrossCurrency}
      <div class="transfer-amounts">
        <MoneyDisplay
          amount={fmt(
            currentIsSource
              ? transfer.source.amount
              : (transfer.target?.amount ?? '0'),
          )}
          currency={currentIsSource
            ? transfer.source.currency
            : (transfer.target?.currency ?? '')}
          {flowDirection}
          inline
        />
        <div class="transfer-exchange">
          <span class="cross-sep">{currentIsSource ? '→' : '←'}</span>
          <MoneyDisplay
            amount={fmt(
              currentIsSource
                ? (transfer.target?.amount ?? '0')
                : transfer.source.amount,
            )}
            currency={currentIsSource
              ? (transfer.target?.currency ?? '')
              : transfer.source.currency}
            inline
          />
        </div>
      </div>
    {:else if currentPosting}
      {#if fxConverted?.status === 'ok'}
        <div
          class="fx-stack"
          class:flow-in={flowDirection === 'in'}
          class:flow-out={flowDirection === 'out'}
        >
          <div class="fx-primary">
            <CurrencyPill code={preferredCurrency} size="xs" />
            <span class="fx-main-amount"
              >{fmt(fxConverted.convertedAmount)}</span
            >
          </div>
          <div class="fx-secondary">
            <span class="fx-tilde">≈</span>
            <span class="fx-orig-code">{fxConverted.originalCurrency}</span>
            <span class="fx-orig-amount">{fmt(currentPosting.amount)}</span>
          </div>
        </div>
      {:else if fxConverted?.status === 'loading'}
        <div class="fx-stack">
          <div class="fx-primary">
            <CurrencyPill code={currentPosting.currency} size="xs" />
            <span class="fx-main-amount fx-muted"
              >{fmt(currentPosting.amount)}</span
            >
          </div>
          <div class="fx-secondary">
            <span class="fx-converting">converting…</span>
          </div>
        </div>
      {:else if fxConverted?.status === 'missing'}
        <div class="fx-stack fx-no-rate">
          <div class="fx-primary">
            <CurrencyPill code={currentPosting.currency} size="xs" />
            <span class="fx-main-amount fx-muted"
              >{fmt(currentPosting.amount)}</span
            >
          </div>
          <div class="fx-secondary">
            <Icon name="warning" size={9} />
            <span>no rate</span>
          </div>
        </div>
      {:else}
        <MoneyDisplay
          amount={fmt(currentPosting.amount)}
          currency={currentPosting.currency}
          {flowDirection}
          inline
        />
      {/if}
    {/if}
  </div>

</div>

<style>
  .row {
    display: grid;
    grid-template-columns: var(--tx-cols);
    align-items: center;
    gap: var(--sp-xs);
    padding: 7px 14px;
    background: var(--color-window-raised);
    border-bottom: 1px solid var(--color-rule);
    cursor: pointer;
    text-align: left;
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

  .row:last-child {
    border-bottom: none;
  }

  /* --- Date --- */
  .date {
    display: flex;
    flex-direction: column;
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

  /* --- Description --- */
  .desc-cell {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    min-width: 0;
    overflow: hidden;
  }

  .description {
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

  .transfer-tag {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  /* --- Account column --- */
  .account-cell {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .dir-arrow {
    color: var(--color-text-muted);
    flex: 0 0 1.25rem;
    text-align: center;
  }

  .dir-arrow.flow-in {
    color: var(--color-transfer-in);
  }

  .dir-arrow.flow-out {
    color: var(--color-transfer-out);
  }

  .account {
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .transfer .account {
    color: var(--color-text-muted);
  }

  .account-uncategorized {
    color: var(--color-warning);
  }

  .fees {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 10px;
    color: var(--color-text-muted);
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* --- Amount --- */
  .amount-cell {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .transfer-amounts {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
  }

  .transfer-exchange {
    display: flex;
    align-items: center;
    gap: 3px;
    opacity: 0.6;
  }

  .transfer-exchange :global(.amount),
  .transfer-exchange :global(.currency) {
    font-size: 10px;
  }

  .cross-sep {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* --- FX converted amount --- */
  .fx-stack {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }

  .fx-primary {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .fx-main-amount {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--color-text);
  }

  .fx-stack.flow-in .fx-main-amount {
    color: var(--color-transfer-in);
  }
  .fx-stack.flow-out .fx-main-amount {
    color: var(--color-transfer-out);
  }

  .fx-main-amount.fx-muted {
    color: var(--color-text-muted);
  }

  .fx-secondary {
    display: flex;
    align-items: center;
    gap: 3px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
  }

  .fx-tilde {
    opacity: 0.5;
  }

  .fx-orig-code {
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .fx-orig-amount {
    font-variant-numeric: tabular-nums;
  }

  .fx-converting {
    font-style: italic;
    opacity: 0.6;
  }

  .fx-no-rate .fx-secondary {
    color: var(--color-warning);
    gap: 4px;
  }

  /* Mobile: stack desc and account below the date/amount row */
  @media (max-width: 520px) {
    .row {
      grid-template-columns: auto 1fr auto;
      grid-template-rows: auto auto auto;
      grid-template-areas:
        'date   .       amount'
        'desc   desc    desc'
        'acct   acct    acct';
      min-height: unset;
      padding: var(--sp-xs) var(--sp-sm) 0;
      border-bottom: 2px solid var(--color-border);
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
    .desc-cell {
      grid-area: desc;
      border-top: 1px solid var(--color-divider);
      padding-top: var(--sp-xs);
    }
    .account-cell {
      grid-area: acct;
      padding-bottom: var(--sp-xs);
    }
    .amount-cell {
      grid-area: amount;
    }
  }
</style>
