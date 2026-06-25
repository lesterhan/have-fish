<script module>
  function focusOnMount(node: HTMLElement) {
    node.focus()
  }
</script>

<script lang="ts">
  // Summary edit — the default edit surface for a multi-posting transaction. Exposes only the
  // *meaningful* fields: the subject leg's account (recategorize), the description, and the
  // date. The mechanical legs (transfer/conversion/fee) and Fish Pie share legs are shown
  // read-only as "how it moved" — they can't be hand-edited here, so the entry can't be
  // unbalanced. Recategorizing repoints a subject leg's account only; amounts never change,
  // and the backend re-validates balance on save (replacePostings). "Edit ledger postings"
  // drops to the full LedgerEditModal for power edits and shapes this view can't narrate.
  import Modal from '$lib/components/ui/Modal.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import { narrateTransaction } from './narrate'
  import { initialSubjectDrafts, hasAccountChange, buildRecategorizePayload, type SubjectDraft } from './summaryEdit'
  import {
    patchTransaction,
    replacePostings,
    deleteTransaction,
    removeGroupExpense,
    type Account,
    type Transaction,
  } from '$lib/api'

  interface Props {
    tx: Transaction
    accounts: Account[]
    open: boolean
    onclose: () => void
    onaccountcreated?: (account: Account) => void
    // Returns the saved transaction with freshly classified (enriched) postings.
    onsaved?: (updated: Transaction) => void
    ondeleted?: () => void
    onremovedFromGroup?: () => void
    // Drop to the ledger posting editor (escape hatch).
    oneditledger: () => void
  }

  let { tx, accounts, open = $bindable(), onclose, onaccountcreated, onsaved, ondeleted, onremovedFromGroup, oneditledger }: Props = $props()

  // --- Snapshot + local editing state (reset when the modal opens) ---
  let origDate = $state('')
  let origDescription = $state('')
  let localDate = $state('')
  let localDescription = $state('')
  let subjectDrafts = $state<SubjectDraft[]>([])
  let showDiscardConfirm = $state(false)
  let showDeleteConfirm = $state(false)
  let showRemoveGroupConfirm = $state(false)
  let dateEditing = $state(false)
  let descEditing = $state(false)

  $effect(() => {
    if (open) {
      origDate = tx.date.substring(0, 10)
      origDescription = tx.description ?? ''
      localDate = origDate
      localDescription = origDescription
      subjectDrafts = initialSubjectDrafts(tx.postings)
      showDiscardConfirm = false
      showDeleteConfirm = false
      showRemoveGroupConfirm = false
      dateEditing = false
      descEditing = false
    }
  })

  let n = $derived(narrateTransaction(tx.postings))
  let hasMovement = $derived(
    n.movement.source !== null || n.movement.flow !== null || n.movement.fees.length > 0,
  )

  let accountChanged = $derived(hasAccountChange(tx.postings, subjectDrafts))
  let dirty = $derived(
    localDate !== origDate || localDescription !== origDescription || accountChanged,
  )

  // Absolute, 2dp — direction is conveyed by account name, not sign.
  function amt(amount: string): string {
    return Math.abs(parseFloat(amount)).toFixed(2)
  }

  let dateLabel = $derived.by(() => {
    const d = new Date(localDate + 'T00:00:00')
    return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  })

  // --- Date editing ---
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
    if (e.key === 'Escape') dateEditing = false
  }

  // --- Description editing ---
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
    if (e.key === 'Escape') descEditing = false
  }

  function handleEditableKeydown(e: KeyboardEvent, action: () => void) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      action()
    }
  }

  // --- Subject account editing ---
  function setSubjectAccount(postingId: string, accountId: string) {
    const idx = subjectDrafts.findIndex((d) => d.postingId === postingId)
    if (idx >= 0) subjectDrafts[idx].accountId = accountId
  }

  // The subject legs paired with their drafts, for rendering (preserves narration order).
  let subjectRows = $derived(
    n.subjects.map((s) => ({
      posting: s,
      draft: subjectDrafts.find((d) => d.postingId === s.id) ?? { postingId: s.id, accountId: s.accountId },
    })),
  )

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
      // Repoint subject accounts first (balance re-validated server-side), then the header.
      let updated: Transaction = tx
      if (accountChanged) {
        const payload = buildRecategorizePayload(tx.postings, subjectDrafts)
        updated = await replacePostings(tx.id, payload)
      }
      if (localDate !== origDate || localDescription !== origDescription) {
        await patchTransaction(tx.id, {
          ...(localDate !== origDate ? { date: localDate } : {}),
          ...(localDescription !== origDescription ? { description: localDescription || null } : {}),
        })
      }
      onsaved?.({
        ...updated,
        date: localDate,
        description: localDescription || null,
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

  // --- Remove from group ---
  let removingFromGroup = $state(false)
  async function handleRemoveFromGroup() {
    if (!tx.groupExpenseId) return
    removingFromGroup = true
    try {
      await removeGroupExpense(tx.groupExpenseId)
      onremovedFromGroup?.()
      onclose()
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Remove failed'
      showRemoveGroupConfirm = false
    } finally {
      removingFromGroup = false
    }
  }
</script>

<Modal title="Edit Transaction" {open} onclose={requestClose}>
  <div class="modal-body">
    <!-- Header: date + description (click to edit) -->
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
          {dateLabel}
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

    <!-- Subjects: editable account, read-only amount -->
    <div class="subjects">
      {#each subjectRows as row (row.posting.id)}
        <div class="subject">
          <div class="subject-account">
            <AccountPathInput
              {accounts}
              value={row.draft.accountId}
              oncommit={(id) => setSubjectAccount(row.posting.id, id)}
              oncreate={onaccountcreated}
            />
          </div>
          <span class="money">
            <CurrencyPill code={row.posting.currency} size="xs" />
            <span class="amount">{amt(row.posting.amount)}</span>
          </span>
        </div>
      {/each}
    </div>

    <!-- Fish Pie share legs (read-only) -->
    {#each n.shares as sh (sh.id)}
      <div class="share">
        split with {tx.groupName ?? 'group'}
        <span class="share-amount">
          <CurrencyPill code={sh.currency} size="xs" />
          <span class="amount">{amt(sh.amount)}</span>
        </span>
      </div>
    {/each}

    <!-- Mechanical legs (read-only) -->
    {#if hasMovement}
      <div class="movement">
        <span class="movement-label">how it moved</span>
        <div class="movement-body">
          {#if n.movement.source}
            <span class="from">{n.movement.source.accountPath}</span>
          {/if}
          {#if n.movement.flow}
            <span class="flow">
              <CurrencyPill code={n.movement.flow.from.currency} size="xs" />
              <span class="amount">{n.movement.flow.from.amount}</span>
              <span class="arrow" aria-hidden="true">→</span>
              <CurrencyPill code={n.movement.flow.to.currency} size="xs" />
              <span class="amount">{n.movement.flow.to.amount}</span>
            </span>
          {/if}
          {#each n.movement.fees as fee (fee.id)}
            <span class="fee">
              fee
              <CurrencyPill code={fee.currency} size="xs" />
              <span class="amount">{amt(fee.amount)}</span>
            </span>
          {/each}
        </div>
      </div>
    {/if}

    <button class="ledger-link" onclick={oneditledger}>Edit ledger postings…</button>

    {#if tx.groupExpenseId}
      <div class="group-link-row">
        <span class="group-link-label">Shared to <strong>{tx.groupName ?? 'Fish Pie'}</strong></span>
        {#if showRemoveGroupConfirm}
          <span class="confirm-inline-text">Remove for all members?</span>
          <GradientButton variant="warning" active disabled={removingFromGroup} onclick={handleRemoveFromGroup}>
            {removingFromGroup ? 'Removing…' : 'Confirm remove'}
          </GradientButton>
          <GradientButton disabled={removingFromGroup} onclick={() => (showRemoveGroupConfirm = false)}>Cancel</GradientButton>
        {:else}
          <GradientButton variant="warning" onclick={() => (showRemoveGroupConfirm = true)}>Remove from group</GradientButton>
        {/if}
      </div>
    {/if}

    {#if showDiscardConfirm}
      <div class="confirm-row">
        <span class="confirm-text">Discard changes?</span>
        <GradientButton onclick={() => (showDiscardConfirm = false)}>Keep editing</GradientButton>
        <GradientButton variant="warning" active onclick={discard}>Discard</GradientButton>
      </div>
    {:else if showDeleteConfirm}
      <div class="confirm-row">
        <span class="confirm-text">Delete this transaction?</span>
        <GradientButton onclick={() => (showDeleteConfirm = false)}>Cancel</GradientButton>
        <GradientButton variant="warning" active disabled={deleting} onclick={handleDelete}>
          {deleting ? 'Deleting…' : 'Delete'}
        </GradientButton>
      </div>
    {:else}
      {#if saveError}
        <p class="save-error" role="alert">{saveError}</p>
      {/if}
      <div class="footer">
        <GradientButton variant="warning" active disabled={saving} onclick={() => (showDeleteConfirm = true)}>Delete</GradientButton>
        <div class="footer-actions">
          <GradientButton disabled={saving} onclick={requestClose}>Cancel</GradientButton>
          <GradientButton active disabled={!dirty || saving} onclick={handleSave}>
            <Icon name="floppy" size={12} />{saving ? 'Saving…' : 'Save'}
          </GradientButton>
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
    justify-content: space-between;
    gap: var(--sp-md);
    border-bottom: 1px solid var(--color-rule);
    padding-bottom: var(--sp-xs);
  }

  .tx-date {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .date-input {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
    padding: 3px var(--sp-xs);
    height: 24px;
    outline: none;
    flex-shrink: 0;
    box-sizing: border-box;
    transition:
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .date-input:focus {
    border-color: var(--color-accent-mid);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 2px var(--color-accent-light);
  }

  .tx-description {
    font-family: var(--font-serif);
    font-size: var(--text-base);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .desc-sizer {
    display: inline-grid;
    align-self: flex-start;
    flex: 1;
    font-family: var(--font-serif);
    font-size: var(--text-base);
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
    color: var(--color-text);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
    padding: 3px var(--sp-xs);
    height: 26px;
    outline: none;
    box-sizing: border-box;
    transition:
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .desc-input:focus {
    border-color: var(--color-accent-mid);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 2px var(--color-accent-light);
  }

  /* ---- Subjects (editable account, read-only amount) ---- */
  .subjects {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .subject {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .subject-account {
    flex: 1;
    min-width: 0;
  }

  .money {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .amount {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--color-text);
  }

  /* ---- Share (Fish Pie) ---- */
  .share {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-sm);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .share-amount {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  /* ---- Movement (mechanical legs, read-only) ---- */
  .movement {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-top: var(--sp-xs);
    border-top: 1px dotted var(--color-rule);
  }

  .movement-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }

  .movement-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .from {
    color: var(--color-text-muted);
  }

  .flow,
  .fee {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .arrow {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .movement-body .amount {
    color: var(--color-text-muted);
  }

  /* ---- Ledger escape hatch ---- */
  .ledger-link {
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

  .ledger-link:hover {
    color: var(--color-accent-mid);
  }

  .ledger-link:focus-visible {
    outline: 1px dotted var(--color-text);
    outline-offset: 2px;
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

  /* ---- Group link row ---- */
  .group-link-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window-raised);
    border: 1px solid var(--color-rule);
    font-size: var(--text-xs);
  }

  .group-link-label {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .confirm-inline-text {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-danger);
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
