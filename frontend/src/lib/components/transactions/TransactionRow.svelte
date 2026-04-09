<script module>
  function focusOnMount(node: HTMLInputElement) {
    node.focus()
    node.select()
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import MoneyDisplay from '$lib/components/ui/MoneyDisplay.svelte'
  import TransactionEditModal from '$lib/components/transactions/TransactionEditModal.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { patchTransaction, patchPosting, type Account } from '$lib/api'
  import { settingsStore } from '$lib/settings.svelte'

  interface Posting {
    id: string
    accountId: string
    amount: string
    currency: string
  }

  interface Transaction {
    id: string
    date: string
    description: string | null
    postings: Posting[]
  }

  interface Props {
    tx: Transaction
    accounts: Account[]
    defaultOffsetAccountId?: string | null
    defaultConversionAccountId?: string | null
    currentAccountId?: string | null
    onaccountcreated?: (account: Account) => void
    ondeleted?: () => void
  }

  let {
    tx,
    accounts,
    defaultOffsetAccountId,
    defaultConversionAccountId,
    currentAccountId = null,
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

  function handleEditableKeydown(e: KeyboardEvent, action: () => void) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      action()
    }
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

  // --- Date display ---
  // Parse YYYY-MM-DD as local midnight to avoid UTC timezone shift.
  function parseDateParts(isoDate: string) {
    // Slice to YYYY-MM-DD before splitting — avoids new Date(str) treating
    // a bare date string as UTC midnight and shifting it into the previous day
    // for UTC- timezones. new Date(y, m-1, d) always creates local midnight.
    const [y, m, d] = isoDate.substring(0, 10).split('-').map(Number)
    const date = new Date(y, m - 1, d)
    return {
      dow: date.toLocaleDateString('en', { weekday: 'short' }),
      monthDay: date.toLocaleDateString('en', {
        month: 'short',
        day: 'numeric',
      }),
      year: String(y),
    }
  }

  let dateParts = $derived(parseDateParts(localDate))

  // --- Display helpers ---

  // A cross-currency transfer has postings in more than one currency.
  // These transactions (typically 4–5 postings with a conversion account)
  // need a different layout from the standard from→to summary.
  let isCrossCurrency = $derived(
    new Set(localPostings.map((p) => p.currency)).size > 1,
  )

  // A transfer moves money between asset/liability/equity accounts.
  // We detect this by checking whether the destination account (most positive
  // posting) is NOT under the expenses root. Cross-currency transactions
  // between personal accounts also qualify.
  let isTransfer = $derived.by(() => {
    const settings = settingsStore.value
    if (!settings) return false
    const expRoot = settings.defaultExpensesRootPath
    const toPath = accountPaths[to.accountId] ?? ''
    return !toPath.startsWith(`${expRoot}:`) && toPath !== expRoot
  })

  // For cross-currency transfers: identify the source (largest outflow) and
  // target (largest inflow in a different currency). Everything else —
  // conversion account entries and fee postings — is treated as internals.
  function classifyTransfer(postings: Posting[]) {
    // Exclude the conversion account's bridging entries — they exist in both
    // currencies and can dwarf the real source/target amounts, causing the
    // sort to pick them as source or target instead of the actual accounts.
    const nonConversion = postings.filter(
      (p) => p.accountId !== defaultConversionAccountId,
    )

    const sorted = [...nonConversion].sort(
      (a, b) => parseFloat(a.amount) - parseFloat(b.amount),
    )
    // Source = most negative non-conversion posting (e.g. assets:wise:eur)
    const source = sorted[0]
    // Target = most positive non-conversion posting in a different currency
    const target = [...nonConversion]
      .filter((p) => p.currency !== source.currency)
      .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))[0]
    // Fees = any remaining positive non-conversion postings (e.g. expenses:fees)
    const internalIds = new Set([source.id, target?.id])
    const fees = nonConversion.filter(
      (p) => !internalIds.has(p.id) && parseFloat(p.amount) > 0,
    )
    return { source, target, fees }
  }

  let transfer = $derived(classifyTransfer(localPostings))

  function summarize(postings: Posting[]) {
    const sorted = [...postings].sort(
      (a, b) => parseFloat(a.amount) - parseFloat(b.amount),
    )
    return {
      from: sorted[0],
      to: sorted[sorted.length - 1],
      rest: sorted.slice(1, -1),
    }
  }

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

<div class="row" class:transfer={isTransfer}>
  <div class="date">
    <span class="date-meta">{dateParts.year} {dateParts.dow}</span>
    <span class="date-main">{dateParts.monthDay}</span>
  </div>

  <div class="body">
    <!-- Description -->
    {#if descEditing}
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
    {:else}
      <span
        class="description editable"
        role="button"
        tabindex="0"
        onclick={startDescEdit}
        onkeydown={(e) => handleEditableKeydown(e, startDescEdit)}
        title="Click to edit"
      >
        {localDescription || '—'}
      </span>
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

      <!-- Extra postings (fees etc.) -->
      {#if rest.length > 0}
        <div class="transfer-fees">
          {#each rest as posting}
            <span class="fee-label">
              fee {Math.abs(parseFloat(posting.amount)).toFixed(2)}
              {posting.currency}
            </span>
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
        amount={Math.abs(parseFloat(transfer.source.amount)).toFixed(2)}
        currency={transfer.source.currency}
      />
      <span class="cross-arrow" aria-hidden="true">➜</span>
      <MoneyDisplay
        amount={parseFloat(transfer.target?.amount ?? '0').toFixed(2)}
        currency={transfer.target?.currency ?? ''}
      />
    {:else if from.currency === to.currency}
      <MoneyDisplay
        amount={Math.abs(parseFloat(from.amount)).toFixed(2)}
        currency={to.currency}
        {flowDirection}
      />
    {:else}
      <MoneyDisplay
        amount={Math.abs(parseFloat(from.amount)).toFixed(2)}
        currency={from.currency}
      />
      <span class="cross-arrow" aria-hidden="true">→</span>
      <MoneyDisplay
        amount={parseFloat(to.amount).toFixed(2)}
        currency={to.currency}
      />
    {/if}
  </div>

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
    grid-template-columns: auto 1fr auto auto;
    grid-template-rows: auto;
    align-items: start;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
    border-bottom: 1px solid var(--color-divider);
    transition: background var(--duration-fast) var(--ease);
  }

  .row:hover {
    background: var(--color-accent-light);
  }

  .row:last-child {
    border-bottom: none;
  }

  .date {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    font-family: var(--font-sans);
  }

  .date-meta {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .date-main {
    font-size: var(--text-base);
    color: var(--color-text);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-left: 1px solid var(--color-divider);
    padding-left: var(--sp-xs);
  }

  .transfer .account-from,
  .transfer .account-to {
    color: var(--color-text-muted);
  }

  .transfer-tag {
    font-family: var(--font-sans);
    font-size: 10px;
    color: var(--color-text-muted);
    align-self: flex-start;
  }

  .description {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-accent-mid);
  }

  /* Auto-sizing description input.
     The ::after pseudo-element mirrors the input value and sets the width;
     the input overlays it in the same grid cell. */
  .desc-sizer {
    display: inline-grid;
    align-self: flex-start;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
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
    font-size: var(--text-sm);
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
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .arrow {
    color: var(--color-text-muted);
    flex-shrink: 0;
    padding: 0 var(--sp-xs);
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
  }

  .cross-arrow {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
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
      border-left: none;
      padding-left: 0;
      border-top: none;
      padding-top: 0;
      padding-bottom: 0;
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
