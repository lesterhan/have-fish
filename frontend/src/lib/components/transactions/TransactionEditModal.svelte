<script module>
  function focusOnMount(node: HTMLElement) {
    node.focus()
  }
</script>

<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import PostingEditorRow from '$lib/components/transactions/PostingEditorRow.svelte'
  import { toISODate } from '$lib/date'
  import {
    patchTransaction,
    patchPosting,
    createPosting,
    deletePosting,
    deleteTransaction,
    type Account,
  } from '$lib/api'

  interface Posting {
    id: string
    accountId: string
    amount: string
    currency: string
  }

  interface LocalPosting {
    id: string
    accountId: string
    amount: string
    currency: string
    markedForDelete: boolean
    isNew: boolean
    autofocusAccount?: boolean
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
    open: boolean
    onclose: () => void
    onaccountcreated?: (account: Account) => void
    onsaved?: (updates: {
      date: string
      description: string | null
      postings: Posting[]
    }) => void
    ondeleted?: () => void
  }

  let {
    tx,
    accounts,
    defaultOffsetAccountId,
    open = $bindable(),
    onclose,
    onaccountcreated,
    onsaved,
    ondeleted,
  }: Props = $props()

  // --- Snapshot of original values (captured when modal opens) ---
  let origDate = $state('')
  let origDescription = $state('')
  let origPostings = $state<Posting[]>([])

  // --- Local editing state ---
  let localDate = $state('')
  let localDescription = $state('')
  let localPostings = $state<LocalPosting[]>([])
  let showDiscardConfirm = $state(false)
  let showDeleteConfirm = $state(false)
  let newIdCounter = $state(0)

  // Reset all local state when the modal opens
  $effect(() => {
    if (open) {
      origDate = tx.date.substring(0, 10)
      origDescription = tx.description ?? ''
      origPostings = [...tx.postings]
      localDate = origDate
      localDescription = origDescription
      localPostings = tx.postings.map((p) => ({
        ...p,
        markedForDelete: false,
        isNew: false,
      }))
      showDiscardConfirm = false
      showDeleteConfirm = false
      dateEditing = false
      descEditing = false
    }
  })

  // Active (non-deleted) postings
  let activePostings = $derived(localPostings.filter((p) => !p.markedForDelete))

  // Per-currency balance (active postings only; skip unparseable amounts while typing)
  let balances = $derived.by(() => {
    const map = new Map<string, number>()
    for (const p of activePostings) {
      const n = parseFloat(p.amount)
      if (!isNaN(n)) map.set(p.currency, (map.get(p.currency) ?? 0) + n)
    }
    return map
  })

  let balanced = $derived(
    [...balances.values()].every((v) => Math.abs(v) < 0.005),
  )

  // Dirty: any field differs from the snapshot
  let dirty = $derived(
    localDate !== origDate ||
      localDescription !== origDescription ||
      localPostings.some((p) => p.isNew || p.markedForDelete) ||
      localPostings.some((p) => {
        const o = origPostings.find((o) => o.id === p.id)
        return (
          o != null &&
          (p.accountId !== o.accountId ||
            p.amount !== o.amount ||
            p.currency !== o.currency)
        )
      }),
  )

  // --- Date editing ---
  let dateEditing = $state(false)
  let dateInputValue = $state('')

  function startDateEdit() {
    dateInputValue = localDate
    dateEditing = true
  }

  function commitDateEdit() {
    if (dateInputValue) localDate = dateInputValue
    dateEditing = false
  }

  function handleDateKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitDateEdit()
    }
    if (e.key === 'Escape') {
      dateEditing = false
    }
  }

  // --- Description editing ---
  let descEditing = $state(false)
  let descInputValue = $state('')

  function startDescEdit() {
    descInputValue = localDescription
    descEditing = true
  }

  function commitDescEdit() {
    localDescription = descInputValue.trim()
    descEditing = false
  }

  function handleDescKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitDescEdit()
    }
    if (e.key === 'Escape') {
      descEditing = false
    }
  }

  function handleEditableKeydown(e: KeyboardEvent, action: () => void) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      action()
    }
  }

  // --- Posting row callbacks ---
  function commitAccount(id: string, accountId: string) {
    const idx = localPostings.findIndex((p) => p.id === id)
    if (idx >= 0) {
      localPostings[idx].accountId = accountId
      localPostings[idx].autofocusAccount = false
    }
  }

  function commitAmount(id: string, amount: string) {
    const idx = localPostings.findIndex((p) => p.id === id)
    if (idx >= 0) localPostings[idx].amount = amount
  }

  function commitCurrency(id: string, currency: string) {
    const idx = localPostings.findIndex((p) => p.id === id)
    if (idx >= 0) localPostings[idx].currency = currency
  }

  function toggleDelete(id: string) {
    const idx = localPostings.findIndex((p) => p.id === id)
    if (idx >= 0)
      localPostings[idx].markedForDelete = !localPostings[idx].markedForDelete
  }

  // --- Add posting ---
  function addPosting() {
    const primaryCurrency = activePostings[0]?.currency ?? 'CAD'
    const id = `new-${newIdCounter++}`
    localPostings.push({
      id,
      accountId: defaultOffsetAccountId ?? '',
      amount: '0.00',
      currency: primaryCurrency,
      markedForDelete: false,
      isNew: true,
      autofocusAccount: true,
    })
  }

  // --- Close / discard ---
  function requestClose() {
    if (dirty) {
      open = true
      showDiscardConfirm = true
    } else {
      onclose()
    }
  }

  function discard() {
    showDiscardConfirm = false
    onclose()
  }

  // --- Save ---
  let saving = $state(false)
  let saveError = $state('')

  async function handleSave() {
    saving = true
    saveError = ''
    try {
      const patchTxCall =
        localDate !== origDate || localDescription !== origDescription
          ? patchTransaction(tx.id, {
              ...(localDate !== origDate ? { date: localDate } : {}),
              ...(localDescription !== origDescription
                ? { description: localDescription || null }
                : {}),
            })
          : Promise.resolve(null)

      const changedPostings = localPostings
        .filter((p) => !p.isNew && !p.markedForDelete)
        .filter((p) => {
          const o = origPostings.find((o) => o.id === p.id)
          return (
            o &&
            (p.accountId !== o.accountId ||
              p.amount !== o.amount ||
              p.currency !== o.currency)
          )
        })
      const patchPostingCalls = changedPostings.map((p) =>
        patchPosting(p.id, {
          accountId: p.accountId,
          amount: p.amount,
          currency: p.currency,
        }),
      )

      const newPostings = localPostings.filter(
        (p) => p.isNew && !p.markedForDelete,
      )
      const createPostingCalls = newPostings.map((p) =>
        createPosting({
          transactionId: tx.id,
          accountId: p.accountId,
          amount: p.amount,
          currency: p.currency,
        }),
      )

      const deletePostingCalls = localPostings
        .filter((p) => p.markedForDelete && !p.isNew)
        .map((p) => deletePosting(p.id))

      const [, createdResults] = await Promise.all([
        Promise.all([patchTxCall, ...patchPostingCalls, ...deletePostingCalls]),
        Promise.all(createPostingCalls),
      ])

      let newIdx = 0
      const updatedPostings: Posting[] = localPostings
        .filter((p) => !p.markedForDelete)
        .map((p) =>
          p.isNew
            ? {
                id: createdResults[newIdx++].id,
                accountId: p.accountId,
                amount: p.amount,
                currency: p.currency,
              }
            : {
                id: p.id,
                accountId: p.accountId,
                amount: p.amount,
                currency: p.currency,
              },
        )

      onsaved?.({
        date: localDate,
        description: localDescription || null,
        postings: updatedPostings,
      })
      onclose()
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Save failed'
    } finally {
      saving = false
    }
  }

  // --- Delete ---
  let deleting = $state(false)

  async function handleDelete() {
    deleting = true
    try {
      await deleteTransaction(tx.id)
      ondeleted?.()
      onclose()
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Delete failed'
      showDeleteConfirm = false
    } finally {
      deleting = false
    }
  }

  // --- Helpers ---
  let accountPaths = $derived(
    Object.fromEntries(accounts.map((a) => [a.id, a.path])),
  )
</script>

<Modal title="Edit Transaction" {open} onclose={requestClose}>
  <div class="modal-body">
    <div class="header-row">
      {#if dateEditing}
        <input
          type="date"
          class="date-input"
          aria-label="Date"
          bind:value={dateInputValue}
          onblur={commitDateEdit}
          onkeydown={handleDateKeydown}
          use:focusOnMount
        />
      {:else}
        <span
          class="tx-date editable"
          role="button"
          tabindex="0"
          onclick={startDateEdit}
          onkeydown={(e) => handleEditableKeydown(e, startDateEdit)}
          title="Click to edit"
        >
          {localDate}
        </span>
      {/if}
      {#if descEditing}
        <div class="desc-sizer" data-value={descInputValue}>
          <input
            class="desc-input"
            bind:value={descInputValue}
            onblur={commitDescEdit}
            onkeydown={handleDescKeydown}
            aria-label="Description"
            use:focusOnMount
          />
        </div>
      {:else}
        <span
          class="tx-description editable"
          role="button"
          tabindex="0"
          onclick={startDescEdit}
          onkeydown={(e) => handleEditableKeydown(e, startDescEdit)}
          title="Click to edit"
        >
          {localDescription || '—'}
        </span>
      {/if}
    </div>

    <div class="postings">
      {#each localPostings as posting (posting.id)}
        <PostingEditorRow
          {posting}
          {accounts}
          {accountPaths}
          origPosting={origPostings.find((o) => o.id === posting.id)}
          canDelete={activePostings.length > 2}
          autofocusAccount={posting.autofocusAccount}
          {onaccountcreated}
          oncommitaccount={commitAccount}
          oncommitamount={commitAmount}
          oncommitcurrency={commitCurrency}
          ontoggledelete={toggleDelete}
        />
      {/each}
    </div>

    <button class="add-posting-btn" onclick={addPosting}>+ Add posting</button>

    <hr class="divider" />

    <div class="balance-row">
      <span class="balance-label">Balance</span>
      {#if balanced}
        <span class="balance-ok">✓ 0.00</span>
      {:else}
        <div class="balance-errors">
          {#each [...balances.entries()] as [currency, total]}
            {#if Math.abs(total) >= 0.005}
              <span class="balance-bad" title="Balance must be zero">
                {total > 0 ? '+' : ''}{total.toFixed(2)}
                {currency}
              </span>
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    {#if showDiscardConfirm}
      <div class="confirm-row">
        <span class="confirm-text">Discard changes?</span>
        <Button
          onclick={() => {
            showDiscardConfirm = false
          }}>Keep editing</Button
        >
        <Button variant="danger" onclick={discard}>Discard</Button>
      </div>
    {:else if showDeleteConfirm}
      <div class="confirm-row">
        <span class="confirm-text">Delete this transaction?</span>
        <Button
          onclick={() => {
            showDeleteConfirm = false
          }}>Cancel</Button
        >
        <Button variant="danger" disabled={deleting} onclick={handleDelete}>
          {deleting ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
    {:else}
      {#if saveError}
        <p class="save-error" role="alert">{saveError}</p>
      {/if}
      <div class="footer">
        <Button
          variant="danger"
          disabled={saving}
          onclick={() => {
            showDeleteConfirm = true
          }}>Delete</Button
        >
        <div class="footer-actions">
          <Button disabled={saving} onclick={requestClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!balanced || !dirty || saving}
            onclick={handleSave}
          >
            <Icon name="floppy" size={12} />{saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    {/if}
  </div>
</Modal>

<style>
  .modal-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    min-width: 460px;
  }

  /* ---- Header row: date + description ---- */
  .header-row {
    display: flex;
    align-items: baseline;
    gap: var(--sp-md);
  }

  .tx-date {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .date-input {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 1px var(--sp-xs);
    height: 20px;
    outline: none;
    flex-shrink: 0;
  }

  .date-input:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  .tx-description {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-accent-mid);
  }

  .desc-sizer {
    display: inline-grid;
    align-self: flex-start;
    flex: 1;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }

  .desc-sizer::after {
    content: attr(data-value) ' ';
    grid-area: 1 / 1;
    visibility: hidden;
    white-space: pre;
    min-width: 12ch;
  }

  .desc-input {
    grid-area: 1 / 1;
    width: 100%;
    min-width: 0;
    font-family: inherit;
    font-size: inherit;
    font-weight: var(--weight-semibold);
    color: var(--color-accent-mid);
    background: var(--color-window-inset);
    border: none;
    box-shadow: var(--shadow-sunken);
    padding: 1px var(--sp-xs);
    height: 20px;
    outline: none;
  }

  .desc-input:focus {
    outline: 1px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  /* ---- Postings list ---- */
  .postings {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /* ---- Add posting button ---- */
  .add-posting-btn {
    align-self: flex-start;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    outline: none;
    transition: color var(--duration-fast) var(--ease);
  }

  .add-posting-btn:hover {
    color: var(--color-text);
  }

  .add-posting-btn:focus-visible {
    outline: 1px dotted var(--color-text);
    outline-offset: 2px;
  }

  /* ---- Divider + balance ---- */
  .divider {
    border: none;
    border-top: 1px solid var(--color-divider);
    margin: 0;
  }

  .balance-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .balance-label {
    color: var(--color-text-muted);
  }

  .balance-ok {
    color: var(--color-success);
  }

  .balance-errors {
    display: flex;
    gap: var(--sp-sm);
  }

  .balance-bad {
    color: var(--color-danger);
  }

  /* ---- Footer ---- */
  .save-error {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-danger);
    margin: 0;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: var(--sp-xs);
    border-top: 1px solid var(--color-divider);
  }

  .footer-actions {
    display: flex;
    gap: var(--sp-sm);
  }

  .confirm-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding-top: var(--sp-xs);
    border-top: 1px solid var(--color-divider);
  }

  .confirm-text {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    flex: 1;
  }

  /* ---- Shared editable style ---- */
  .editable {
    cursor: text;
    outline: 1px dashed transparent;
    outline-offset: 1px;
    transition: outline-color var(--duration-fast) var(--ease);
  }

  .editable:hover {
    outline-color: var(--color-text-muted);
  }
</style>
