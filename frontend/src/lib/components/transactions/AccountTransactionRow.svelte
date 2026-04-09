<script lang="ts">
  import { untrack } from 'svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import TransactionEditModal from '$lib/components/transactions/TransactionEditModal.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { patchTransaction, patchPosting, type Account } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
  import MoneyDisplay from '$lib/components/ui/MoneyDisplay.svelte'
  import {
    focusOnMount,
    parseDateParts,
    summarize,
    classifyTransfer,
    fmt,
    handleEditableKeydown,
    type Posting,
    type Transaction,
  } from './transactionUtils'

  interface Props {
    tx: Transaction
    accounts: Account[]
    currentAccountId: string
    defaultOffsetAccountId?: string | null
    defaultConversionAccountId?: string | null
    onaccountcreated?: (account: Account) => void
    ondeleted?: () => void
  }

  let {
    tx,
    accounts,
    currentAccountId,
    defaultOffsetAccountId,
    defaultConversionAccountId,
    onaccountcreated,
    ondeleted,
  }: Props = $props()

  let modalOpen = $state(false)

  let localDate = $state(untrack(() => tx.date))
  let localDescription = $state(untrack(() => tx.description ?? ''))
  let localPostings = $state(untrack(() => [...tx.postings]))

  let accountPaths = $derived(
    Object.fromEntries(accounts.map((a) => [a.id, a.path])),
  )

  // --- Description editing ---
  let descEditing = $state(false)
  let descValue = $state('')
  let descError = $state('')

  function startDescEdit() {
    editingPostingId = null
    descValue = localDescription
    descEditing = true
    descError = ''
  }

  async function commitDescEdit() {
    descEditing = false
    const next = descValue.trim()
    if (next === localDescription) return
    try {
      await patchTransaction(tx.id, { description: next || null })
      localDescription = next
    } catch (e) {
      descError = e instanceof Error ? e.message : 'Save failed'
    }
  }

  function cancelDescEdit() {
    descEditing = false
    descError = ''
  }

  function handleDescKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitDescEdit()
    }
    if (e.key === 'Escape') cancelDescEdit()
  }

  // --- Posting account editing ---
  let editingPostingId = $state<string | null>(null)
  let editAccountId = $state('')
  let postingError = $state('')

  function startPostingEdit(postingId: string, accountId: string) {
    descEditing = false
    editingPostingId = postingId
    editAccountId = accountId
    postingError = ''
  }

  async function handlePostingCommit(accountId: string) {
    const id = editingPostingId
    if (!id) return
    editingPostingId = null
    try {
      await patchPosting(id, { accountId })
      localPostings = localPostings.map((p) =>
        p.id === id ? { ...p, accountId } : p,
      )
    } catch (e) {
      postingError = e instanceof Error ? e.message : 'Save failed'
    }
  }

  function handlePostingFocusout(e: FocusEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      const id = editingPostingId
      setTimeout(() => {
        if (editingPostingId === id) editingPostingId = null
      }, 200)
    }
  }

  let dateParts = $derived(parseDateParts(localDate))

  // --- Transaction classification ---
  let isCrossCurrency = $derived(
    new Set(localPostings.map((p) => p.currency)).size > 1,
  )

  let { from, to, rest } = $derived(summarize(localPostings))

  let isTransfer = $derived.by(() => {
    const settings = settingsStore.value
    if (!settings) return false
    const expRoot = settings.defaultExpensesRootPath
    const toPath = accountPaths[to.accountId] ?? ''
    return !toPath.startsWith(`${expRoot}:`) && toPath !== expRoot
  })

  let transfer = $derived(
    classifyTransfer(localPostings, defaultConversionAccountId),
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
    const posting = localPostings.find((p) => p.accountId === currentAccountId)
    if (!posting) return null
    return parseFloat(posting.amount) > 0 ? 'in' : 'out'
  })

  // Amount values for the current account's perspective.
  let currentPosting = $derived(
    localPostings.find((p) => p.accountId === currentAccountId),
  )
</script>

<div class="row" class:transfer={isTransfer}>
  <!-- Date -->
  <div class="date">
    <span class="date-meta">{dateParts.year} {dateParts.dow}</span>
    <span class="date-main">{dateParts.monthDay}</span>
  </div>

  <!-- Description -->
  <div class="desc-cell">
    {#if descEditing}
      <div class="desc-sizer" data-value={descValue}>
        <input
          class="edit-input"
          bind:value={descValue}
          onblur={commitDescEdit}
          onkeydown={handleDescKeydown}
          aria-label="Description"
          use:focusOnMount
        />
      </div>
    {:else}
      <span
        class="description editable"
        role="button"
        tabindex="0"
        onclick={startDescEdit}
        onkeydown={(e) => handleEditableKeydown(e, startDescEdit)}
        title="Click to edit">{localDescription || '—'}</span
      >
    {/if}
    {#if isTransfer}<span class="transfer-tag">⇄</span>{/if}
    {#if descError}<span class="edit-error" role="alert">{descError}</span>{/if}
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
      {#if editingPostingId === to.id}
        <div class="account-edit-wrapper" onfocusout={handlePostingFocusout}>
          <AccountPathInput
            {accounts}
            bind:value={editAccountId}
            oncommit={handlePostingCommit}
            oncreate={onaccountcreated}
          />
        </div>
      {:else}
        <span
          class="account editable"
          class:account-uncategorized={to.accountId === defaultOffsetAccountId}
          role="button"
          tabindex="0"
          onclick={() => startPostingEdit(to.id, to.accountId)}
          onkeydown={(e) =>
            handleEditableKeydown(e, () =>
              startPostingEdit(to.id, to.accountId),
            )}
          title="Click to edit"
          >{accountPaths[to.accountId] ?? to.accountId}</span
        >
      {/if}
    {:else if currentIsTo}
      <span
        class="dir-arrow"
        class:flow-in={isTransfer && flowDirection === 'in'}
        class:flow-out={isTransfer && flowDirection === 'out'}
      >
        ↩</span
      >
      {#if editingPostingId === from.id}
        <div class="account-edit-wrapper" onfocusout={handlePostingFocusout}>
          <AccountPathInput
            {accounts}
            bind:value={editAccountId}
            oncommit={handlePostingCommit}
            oncreate={onaccountcreated}
          />
        </div>
      {:else}
        <span
          class="account editable"
          class:account-uncategorized={from.accountId ===
            defaultOffsetAccountId}
          role="button"
          tabindex="0"
          onclick={() => startPostingEdit(from.id, from.accountId)}
          onkeydown={(e) =>
            handleEditableKeydown(e, () =>
              startPostingEdit(from.id, from.accountId),
            )}
          title="Click to edit"
          >{accountPaths[from.accountId] ?? from.accountId}</span
        >
      {/if}
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
    {#if postingError}<span class="edit-error" role="alert">{postingError}</span
      >{/if}
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
      <MoneyDisplay
        amount={fmt(currentPosting.amount)}
        currency={currentPosting.currency}
        {flowDirection}
        inline
      />
    {/if}
  </div>

  <!-- Actions -->
  <div class="actions">
    <Button
      tooltip="Edit transaction"
      variant="ghost"
      square
      onclick={() => (modalOpen = true)}
    >
      <Icon name="edit-txn" />
    </Button>
  </div>
</div>

<TransactionEditModal
  tx={{
    ...tx,
    date: localDate,
    description: localDescription || null,
    postings: localPostings,
  }}
  {accounts}
  {defaultOffsetAccountId}
  bind:open={modalOpen}
  onclose={() => (modalOpen = false)}
  {onaccountcreated}
  {ondeleted}
  onsaved={(updates) => {
    localDate = updates.date
    localDescription = updates.description ?? ''
    localPostings = updates.postings
  }}
/>

<style>
  .row {
    display: grid;
    grid-template-columns: var(--tx-cols) auto;
    align-items: center;
    gap: var(--sp-xs);
    padding: 0 var(--sp-sm);
    min-height: 2.75rem;
    border-bottom: 1px solid var(--color-divider);
    transition: background var(--duration-fast) var(--ease);
  }

  .row:hover {
    background: var(--color-accent-light);
  }

  .row:last-child {
    border-bottom: none;
  }

  /* --- Date --- */
  .date {
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-family: var(--font-sans);
    flex-shrink: 0;
  }

  .date-meta {
    font-size: 10px;
    color: var(--color-text-muted);
  }

  .date-main {
    font-size: var(--text-sm);
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
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-accent-mid);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .transfer-tag {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .desc-sizer {
    display: inline-grid;
    align-self: center;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    min-width: 0;
    flex: 1;
  }

  .desc-sizer::after {
    content: attr(data-value) ' ';
    grid-area: 1 / 1;
    visibility: hidden;
    white-space: pre;
    min-width: 8ch;
  }

  .desc-sizer .edit-input {
    grid-area: 1 / 1;
    width: 100%;
    min-width: 0;
  }

  /* --- Account column --- */
  .account-cell {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
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

  .account-edit-wrapper {
    flex: 1;
    min-width: 0;
    max-width: 260px;
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

  /* --- Shared input style --- */
  .edit-input {
    font-family: inherit;
    font-size: inherit;
    color: var(--color-text);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 1px var(--sp-xs);
    height: 20px;
    outline: none;
  }

  .edit-input:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  .editable {
    cursor: text;
    outline: 1px dashed transparent;
    outline-offset: 1px;
    transition: outline-color var(--duration-fast) var(--ease);
  }

  .editable:hover {
    outline-color: var(--color-text-muted);
  }

  .edit-error {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-danger);
    flex-shrink: 0;
  }

  /* --- Actions --- */
  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  /* Mobile: stack desc and account below the date/amount/actions row */
  @media (max-width: 520px) {
    .row {
      grid-template-columns: auto 1fr auto auto;
      grid-template-rows: auto auto auto;
      grid-template-areas:
        'date   .       amount  actions'
        'desc   desc    desc    desc'
        'acct   acct    acct    acct';
      min-height: unset;
      padding: var(--sp-xs) var(--sp-sm) 0;
      border-bottom: 2px solid var(--color-bevel-dark);
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
    .actions {
      grid-area: actions;
    }
  }
</style>
