<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte'
  import { type Account, type Transaction } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import { isUnderRoot } from '$lib/components/accounts/accountPaths'
  import MoneyDisplay from '$lib/components/ui/MoneyDisplay.svelte'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import { summarize, classifyTransfer, fmt } from './transactionUtils'
  import { ledgerTone, typeResolver } from './ledger'

  interface Props {
    tx: Transaction
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
    return !isUnderRoot(toPath, expRoot)
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

  // Amount colour is by exception here — see `ledger.ts`. Which posting to ask about and
  // what its sign means are both the helper's business now, so this page and the global
  // transactions list reach the same answer for the same row.
  let typeOf = $derived(typeResolver(accounts))

  let tone = $derived(ledgerTone(tx.postings, typeOf, currentAccountId))

  // MoneyDisplay's flow classes paint --color-transfer-* directly, which would outrank the
  // cell's tone and turn every refund teal. Only a genuine transfer gets a flow direction
  // on the figure; the row's own arrows still use `flowDirection`, so the counterpart
  // column is untouched.
  let amountFlow = $derived(tone === 'transfer' ? flowDirection : null)

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
          flowDirection={amountFlow}
          inline
          emphasis
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
          class:flow-in={amountFlow === 'in'}
          class:flow-out={amountFlow === 'out'}
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
          flowDirection={amountFlow}
          {tone}
          inline
          emphasis
        />
      {/if}
    {/if}
  </div>
</div>

<style>
  /* One surface, ruled. The alternating fill that used to separate rows is gone: with a day
     band above every run, the striping was a second structure saying something the first one
     already said, and it made a quiet list look busier than the day it described. */
  .row {
    display: grid;
    grid-template-columns: var(--tx-cols);
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--gutter);
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule-soft);
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast) var(--ease);
  }

  .row:hover {
    background: var(--color-accent-chip-bg);
  }

  .row:focus-visible {
    outline: 2px solid var(--color-accent-hi);
    outline-offset: -2px;
  }

  .row:last-child {
    border-bottom: none;
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
    font-size: var(--text-body);
    font-weight: var(--weight-normal);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: text-decoration-color var(--duration-fast) var(--ease);
  }

  /* Clickability arrives on hover rather than sitting on every row at rest. */
  .row:hover .description,
  .row:focus-visible .description {
    text-decoration: underline;
    text-decoration-style: dotted;
    text-decoration-color: var(--color-accent);
    text-underline-offset: 2px;
  }

  .transfer-tag {
    font-size: var(--text-dense);
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
    font-size: var(--text-control);
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
    gap: var(--sp-4xs);
    font-size: var(--text-label);
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
    color: var(--color-text);
  }

  .transfer-amounts {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--sp-hair);
  }

  .transfer-exchange {
    display: flex;
    align-items: center;
    gap: var(--sp-3xs);
    opacity: 0.6;
  }

  .transfer-exchange :global(.amount),
  .transfer-exchange :global(.currency) {
    font-size: var(--text-label);
  }

  .cross-sep {
    font-family: var(--font-mono);
    font-size: var(--text-dense);
    color: var(--color-text-muted);
  }

  /* --- FX converted amount --- */
  .fx-stack {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--sp-4xs);
    flex-shrink: 0;
  }

  .fx-primary {
    display: flex;
    align-items: center;
    gap: var(--sp-3xs);
  }

  .fx-main-amount {
    font-family: var(--font-mono);
    font-size: var(--text-body);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
    color: inherit;
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
    gap: var(--sp-3xs);
    font-family: var(--font-mono);
    font-size: var(--text-label);
    color: var(--color-text-muted);
  }

  .fx-tilde {
    opacity: 0.5;
  }

  .fx-orig-code {
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
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
    gap: var(--sp-3xs);
  }

  /* Mobile: description and account stack under the amount. The date is not in this
     picture any more — the day band above the run carries it once for the whole day. */
  @media (max-width: 520px) {
    .row {
      grid-template-columns: 1fr auto;
      grid-template-rows: auto auto;
      grid-template-areas:
        'desc   amount'
        'acct   acct';
      min-height: unset;
      padding: var(--sp-xs) var(--sp-sm) 0;
      border-bottom: 1px solid var(--color-rule);
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
