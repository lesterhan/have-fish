<script lang="ts">
  import { untrack } from 'svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import MoneyDisplay from '$lib/components/ui/MoneyDisplay.svelte'
  import TransactionEditModal from '$lib/components/transactions/TransactionEditModal.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { patchTransaction, patchPosting, type Account } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'
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
    defaultOffsetAccountId?: string | null
    defaultConversionAccountId?: string | null
    currentAccountId?: string | null
    selectable?: boolean
    selected?: boolean
    ontoggleselect?: (id: string) => void
    onaccountcreated?: (account: Account) => void
    ondeleted?: () => void
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
    onaccountcreated,
    ondeleted,
  }: Props = $props()

  let modalOpen = $state(false)

  // Local copies of mutable fields — updated after a successful save.
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
    if (selectable) return
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

  // Close posting edit when focus leaves the AccountPathInput wrapper.
  // The 200ms delay lets AccountPathInput's own 150ms blur handler run first.
  function handlePostingFocusout(e: FocusEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      const id = editingPostingId
      setTimeout(() => {
        if (editingPostingId === id) editingPostingId = null
      }, 200)
    }
  }

  let dateParts = $derived(parseDateParts(localDate))

  // A cross-currency transfer has postings in more than one currency.
  let isCrossCurrency = $derived(
    new Set(localPostings.map((p) => p.currency)).size > 1,
  )

  let isTransfer = $derived.by(() => {
    const settings = settingsStore.value
    if (!settings) return false
    const expRoot = settings.defaultExpensesRootPath
    const toPath = accountPaths[to.accountId] ?? ''
    return !toPath.startsWith(`${expRoot}:`) && toPath !== expRoot
  })

  let transfer = $derived(classifyTransfer(localPostings, defaultConversionAccountId))
  let { from, to, rest } = $derived(summarize(localPostings))

  // When viewing a specific account page, identify which side of the transaction
  // is the current account so we can suppress it and show only the other side.
  let currentIsFrom = $derived(currentAccountId !== null && from.accountId === currentAccountId)
  let currentIsTo = $derived(currentAccountId !== null && to.accountId === currentAccountId)
  let currentIsSource = $derived(currentAccountId !== null && transfer.source?.accountId === currentAccountId)
  let currentIsTarget = $derived(currentAccountId !== null && transfer.target?.accountId === currentAccountId)

  // When viewing a specific account, determine if money is flowing in or out.
  let flowDirection = $derived.by((): 'in' | 'out' | null => {
    if (!currentAccountId || !isTransfer) return null
    const posting = localPostings.find((p) => p.accountId === currentAccountId)
    if (!posting) return null
    return parseFloat(posting.amount) > 0 ? 'in' : 'out'
  })
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="row"
  class:transfer={isTransfer}
  class:selectable
  class:selected
  onclick={selectable ? () => ontoggleselect?.(tx.id) : undefined}
  role={selectable ? "checkbox" : undefined}
  aria-checked={selectable ? selected : undefined}
  tabindex={selectable ? 0 : undefined}
  onkeydown={selectable ? (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); ontoggleselect?.(tx.id) } } : undefined}
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
    {#if descEditing && !selectable}
      <!-- Auto-sizes to text width via the CSS grid sizer trick -->
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
    {:else if !selectable}
      <button
        class="description editable"
        onclick={(e) => { e.stopPropagation(); startDescEdit() }}
        onkeydown={(e) => handleEditableKeydown(e, startDescEdit)}
        title="Click to edit"
      >
        {localDescription || '—'}
      </button>
    {:else}
      <span class="description">{localDescription || '—'}</span>
    {/if}
    {#if descError}<span class="edit-error" role="alert">{descError}</span>{/if}

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
            {accountPaths[transfer.source.accountId] ?? transfer.source.accountId}
          </span>
          <span class="arrow" aria-hidden="true">←</span>
        {:else}
          <!-- Full display (transactions page or current account not in source/target) -->
          <span class="account account-from account-from-transfer">
            {accountPaths[transfer.source.accountId] ?? transfer.source.accountId}
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
              class="account account-to editable"
              class:account-uncategorized={to.accountId === defaultOffsetAccountId}
              role="button"
              tabindex="0"
              onclick={() => startPostingEdit(to.id, to.accountId)}
              onkeydown={(e) =>
                handleEditableKeydown(e, () =>
                  startPostingEdit(to.id, to.accountId),
                )}
              title="Click to edit"
            >
              {accountPaths[to.accountId] ?? to.accountId}
            </span>
          {/if}
        {:else if currentIsTo}
          <!-- On the "to" account page: show only where money came from -->
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
              class="account account-from editable"
              class:account-uncategorized={from.accountId === defaultOffsetAccountId}
              role="button"
              tabindex="0"
              onclick={() => startPostingEdit(from.id, from.accountId)}
              onkeydown={(e) =>
                handleEditableKeydown(e, () =>
                  startPostingEdit(from.id, from.accountId),
                )}
              title="Click to edit"
            >
              {accountPaths[from.accountId] ?? from.accountId}
            </span>
          {/if}
          <span class="arrow" aria-hidden="true">←</span>
        {:else}
          <!-- Full display (transactions page or current account not in from/to) -->
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
              class="account account-from editable"
              class:account-uncategorized={from.accountId === defaultOffsetAccountId}
              role="button"
              tabindex="0"
              onclick={() => startPostingEdit(from.id, from.accountId)}
              onkeydown={(e) =>
                handleEditableKeydown(e, () =>
                  startPostingEdit(from.id, from.accountId),
                )}
              title="Click to edit"
            >
              {accountPaths[from.accountId] ?? from.accountId}
            </span>
          {/if}

          <span class="arrow" aria-hidden="true">➜</span>

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
              class="account account-to editable"
              class:account-uncategorized={to.accountId === defaultOffsetAccountId}
              role="button"
              tabindex="0"
              onclick={() => startPostingEdit(to.id, to.accountId)}
              onkeydown={(e) =>
                handleEditableKeydown(e, () =>
                  startPostingEdit(to.id, to.accountId),
                )}
              title="Click to edit"
            >
              {accountPaths[to.accountId] ?? to.accountId}
            </span>
          {/if}
        {/if}
      </div>

      {#if rest.length > 0}
        <div class="transfer-fees">
          {#each rest as posting}
            <span class="fee-label">fee {fmt(posting.amount)} {posting.currency}</span>
          {/each}
        </div>
      {/if}
    {/if}

    {#if postingError}<span class="edit-error" role="alert">{postingError}</span
      >{/if}
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
      <MoneyDisplay
        amount={fmt(from.amount)}
        currency={from.currency}
      />
      <span class="cross-arrow" aria-hidden="true">→</span>
      <MoneyDisplay
        amount={fmt(to.amount)}
        currency={to.currency}
      />
    {/if}
  </div>

  {#if !selectable}
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
  {/if}
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
    grid-template-columns: auto 1fr auto auto;
    grid-template-rows: auto;
    align-items: start;
    gap: var(--sp-xs);
    padding: 7px 14px;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-window-raised);
    transition: background var(--duration-fast) var(--ease);
  }

  .row:nth-child(even) {
    background: var(--color-window);
  }

  .row:hover {
    background: var(--color-accent-light);
  }

  .row.selectable {
    grid-template-columns: auto auto 1fr auto;
    cursor: pointer;
  }

  .row.selectable:focus {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
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
    background: linear-gradient(180deg, var(--color-accent-mid), var(--color-accent));
    border-color: var(--color-accent);
  }

  .checkbox.checked::after {
    content: "";
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--color-accent-text);
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

  button.description {
    background: none;
    border: none;
    padding: 0;
    text-align: left;
  }

  .desc-sizer {
    display: inline-grid;
    align-self: flex-start;
    font-family: var(--font-serif);
    font-size: 13px;
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

  .editable {
    cursor: text;
    outline: 1px dashed transparent;
    outline-offset: 1px;
    transition: outline-color var(--duration-fast) var(--ease);
  }

  .editable:hover {
    outline-color: var(--color-text-muted);
  }

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

  .account-edit-wrapper {
    flex: 1;
    min-width: 0;
    max-width: 260px;
  }

  .edit-error {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-danger);
  }

  .actions {
    display: flex;
    align-items: center;
    align-self: center;
  }

  @media (max-width: 520px) {
    .row {
      grid-template-columns: auto 1fr auto;
      grid-template-rows: auto auto;
      grid-template-areas:
        'date money actions'
        'body body body';
      border-bottom: 2px solid var(--color-bevel-dark);
      padding: var(--sp-xs) var(--sp-sm);
      gap: var(--sp-xs);
    }

    .row.selectable {
      grid-template-columns: auto auto 1fr auto;
      grid-template-areas:
        'sel date money .'
        'sel body body body';
    }

    .select-col { grid-area: sel; align-self: center; }

    .date {
      grid-area: date;
      flex-direction: row;
      align-items: baseline;
      gap: var(--sp-xs);
    }

    .date-main { font-size: var(--text-sm); }
    .date-meta { font-size: var(--text-xs); }

    .body {
      grid-area: body;
    }

    .money-col { grid-area: money; justify-self: end; }
    .actions { grid-area: actions; }

    /* Make stacked MoneyDisplay render inline on mobile */
    .money-col :global(.money) {
      flex-direction: row;
      align-items: center;
      gap: var(--sp-xs);
    }

    .money-col :global(.money .amount) {
      font-size: var(--text-sm);
    }

    .summary-line { flex-wrap: wrap; }

    .account-edit-wrapper {
      flex: 1 1 100%;
      max-width: none;
    }
  }
</style>
