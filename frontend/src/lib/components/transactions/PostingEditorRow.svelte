<script module>
  function focusOnMount(node: HTMLElement) {
    node.focus()
  }
</script>

<script lang="ts">
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import CurrencyInput from '$lib/components/ui/CurrencyInput.svelte'
  import type { Account } from '$lib/api'

  interface LocalPosting {
    id: string
    accountId: string
    amount: string
    currency: string
    markedForDelete: boolean
    isNew: boolean
  }

  interface OrigPosting {
    id: string
    amount: string
    currency: string
  }

  interface Props {
    posting: LocalPosting
    accounts: Account[]
    accountPaths: Record<string, string>
    origPosting?: OrigPosting
    canDelete: boolean
    autofocusAccount?: boolean
    onaccountcreated?: (account: Account) => void
    oncommitaccount: (id: string, accountId: string) => void
    oncommitamount: (id: string, amount: string) => void
    oncommitcurrency: (id: string, currency: string) => void
    ontoggledelete: (id: string) => void
  }

  let {
    posting,
    accounts,
    accountPaths,
    origPosting,
    canDelete,
    autofocusAccount = false,
    onaccountcreated,
    oncommitaccount,
    oncommitamount,
    oncommitcurrency,
    ontoggledelete,
  }: Props = $props()

  // --- Account editing ---
  let editingAccount = $state(false)
  let editAccountId = $state('')

  $effect(() => {
    if (autofocusAccount && !posting.markedForDelete) {
      editAccountId = posting.accountId
      editingAccount = true
    }
  })

  function startAccountEdit() {
    editAccountId = posting.accountId
    editingAccount = true
  }

  function commitAccountEdit(accountId: string) {
    editingAccount = false
    oncommitaccount(posting.id, accountId)
  }

  function handleAccountFocusout(e: FocusEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setTimeout(() => {
        editingAccount = false
      }, 200)
    }
  }

  // --- Amount editing ---
  let editingAmount = $state(false)
  let editAmountValue = $state('')

  function startAmountEdit() {
    editAmountValue = posting.amount
    editingAmount = true
  }

  function commitAmountEdit() {
    const n = parseFloat(editAmountValue)
    const amount =
      !isNaN(n) && editAmountValue.trim() !== ''
        ? n.toFixed(2)
        : (origPosting?.amount ?? '0.00')
    editingAmount = false
    oncommitamount(posting.id, amount)
  }

  function handleAmountKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitAmountEdit()
    }
    if (e.key === 'Escape') {
      editingAmount = false
    }
  }

  function handleEditableKeydown(e: KeyboardEvent, action: () => void) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      action()
    }
  }
</script>

<div class="posting-row" class:deleted={posting.markedForDelete}>
  <!-- Account -->
  <div class="posting-account-cell">
    {#if editingAccount && !posting.markedForDelete}
      <div class="account-edit-wrapper" onfocusout={handleAccountFocusout}>
        <AccountPathInput
          {accounts}
          bind:value={editAccountId}
          oncommit={commitAccountEdit}
          oncreate={onaccountcreated}
        />
      </div>
    {:else}
      <span
        class="posting-account"
        class:editable={!posting.markedForDelete}
        role="button"
        aria-disabled={posting.markedForDelete}
        tabindex={posting.markedForDelete ? -1 : 0}
        onclick={() => {
          if (!posting.markedForDelete) startAccountEdit()
        }}
        onkeydown={(e) =>
          !posting.markedForDelete &&
          handleEditableKeydown(e, startAccountEdit)}
        title={posting.markedForDelete ? undefined : 'Click to edit'}
      >
        {accountPaths[posting.accountId] ?? (posting.accountId || '—')}
      </span>
    {/if}
  </div>

  <!-- Amount -->
  {#if editingAmount && !posting.markedForDelete}
    <input
      type="text"
      inputmode="decimal"
      class="amount-input active"
      aria-label="Amount"
      bind:value={editAmountValue}
      onblur={commitAmountEdit}
      onkeydown={handleAmountKeydown}
      use:focusOnMount
    />
  {:else}
    <span
      class="posting-amount"
      class:editable={!posting.markedForDelete}
      role="button"
      aria-disabled={posting.markedForDelete}
      tabindex={posting.markedForDelete ? -1 : 0}
      onclick={() => {
        if (!posting.markedForDelete) startAmountEdit()
      }}
      onkeydown={(e) =>
        !posting.markedForDelete && handleEditableKeydown(e, startAmountEdit)}
      title={posting.markedForDelete ? undefined : 'Click to edit'}
    >
      {posting.amount}
    </span>
  {/if}

  <!-- Currency -->
  <CurrencyInput
    value={posting.currency}
    oncommit={(c) => oncommitcurrency(posting.id, c)}
    style="width: 4rem; flex-shrink: 0"
  />

  <!-- Remove / undo -->
  <button
    class="delete-btn"
    title={posting.markedForDelete ? 'Undo remove' : 'Remove posting'}
    aria-label={posting.markedForDelete
      ? 'Undo remove posting'
      : 'Remove posting'}
    disabled={!posting.markedForDelete && !canDelete}
    onclick={() => ontoggledelete(posting.id)}
  >
    {posting.markedForDelete ? '↩' : '×'}
  </button>
</div>

<style>
  .posting-row {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: var(--sp-xs);
    padding: 2px 0;
  }

  .posting-row.deleted {
    opacity: 0.5;
  }

  .posting-account-cell {
    min-width: 0;
  }

  .posting-account {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-edit-wrapper {
    width: 100%;
  }

  .posting-amount {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
    text-align: right;
  }

  .amount-input.active {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
    padding: 3px var(--sp-xs);
    height: 24px;
    outline: none;
    width: 10ch;
    text-align: right;
    box-sizing: border-box;
    transition:
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .amount-input.active:focus {
    border-color: var(--color-accent-mid);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 2px var(--color-accent-light);
  }

  .delete-btn {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 var(--sp-xs);
    line-height: 1;
    height: 20px;
    outline: none;
    transition: color var(--duration-fast) var(--ease);
  }

  .delete-btn:hover:not(:disabled) {
    color: var(--color-danger);
  }

  .delete-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .delete-btn:focus-visible {
    outline: 1px dotted var(--color-text);
    outline-offset: 1px;
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
</style>
