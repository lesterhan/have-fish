<script lang="ts">
  import type { GroupExpense, GroupSettlement, GroupCategory, Account, GroupMember } from '$lib/api'
  import Icon from '$lib/components/ui/Icon.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import CurrencyInput from '$lib/components/ui/CurrencyInput.svelte'
  import CurrencyPill from '../ui/CurrencyPill.svelte'
  import Chip from '$lib/components/ui/Chip.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import { initials } from './utils'

  interface UpdateExpenseData {
    description?: string
    amount?: string
    currency?: string
    date?: string
    paidByUserId?: string
    splits?: { userId: string; shareWeight: number }[]
    categoryId?: string | null
  }

  interface Props {
    expenses: GroupExpense[]
    settlements: GroupSettlement[]
    members: GroupMember[]
    currentUserId: string
    groupId: string
    allAccounts: Account[]
    categories: GroupCategory[]
    groupCreatedBy: string
    onDeleteExpense: (id: string) => Promise<void>
    onDeleteSettlement: (id: string) => Promise<void>
    onUpdateExpense: (id: string, data: UpdateExpenseData) => Promise<GroupExpense>
    onConfirmSettlement: (
      id: string,
      receiverAccountId: string,
    ) => Promise<void>
  }

  let {
    expenses,
    settlements,
    members,
    currentUserId,
    groupId,
    allAccounts,
    categories,
    groupCreatedBy,
    onDeleteExpense,
    onDeleteSettlement,
    onUpdateExpense,
    onConfirmSettlement,
  }: Props = $props()

  let panelTab = $state<'expenses' | 'settlements'>('expenses')
  let expandedExpenseId = $state<string | null>(null)
  let settlementDeleteConfirmId = $state<string | null>(null)
  let settlementDeleting = $state(false)

  // Edit form state
  let expenseEditId = $state<string | null>(null)
  let editDesc = $state('')
  let editAmount = $state('')
  let editCurrency = $state('')
  let editDate = $state('')
  let editPayerId = $state('')
  let editCategoryId = $state<string | null>(null)
  let editSliderPct = $state(50)

  // Active categories for the chip row; an archived category already on an expense
  // is still shown as selected via the expense's own categoryName.
  const activeCategories = $derived(categories.filter((c) => !c.archivedAt))
  let editSubmitting = $state(false)
  let editSaved = $state(false)
  let editError = $state('')
  let editDeleteConfirm = $state(false)
  let editDeleting = $state(false)

  let editDateInputEl = $state<HTMLInputElement | null>(null)

  // Per-settlement confirm state
  let confirmStates = $state<
    Record<
      string,
      { accountId: string; submitting: boolean; error: string; open: boolean }
    >
  >({})

  function openConfirmForm(id: string) {
    confirmStates[id] = { accountId: '', submitting: false, error: '', open: true }
  }

  function closeConfirmForm(id: string) {
    if (confirmStates[id]) confirmStates[id].open = false
  }

  function canActOnExpense(expense: GroupExpense) {
    return expense.paidByUserId === currentUserId || groupCreatedBy === currentUserId
  }

  function canDeleteSettlement(s: GroupSettlement) {
    return (
      s.fromUserId === currentUserId ||
      s.toUserId === currentUserId ||
      groupCreatedBy === currentUserId
    )
  }

  function computeInitialSlider(expense: GroupExpense): number {
    if (members.length !== 2) return 50
    const total = expense.splits.reduce((s, sp) => s + parseFloat(sp.amount), 0)
    if (total === 0) return 50
    const first = expense.splits.find((s) => s.userId === members[0].userId)
    return first ? Math.round((parseFloat(first.amount) / total) * 100) : 50
  }

  function openEdit(expense: GroupExpense) {
    expenseEditId = expense.id
    expandedExpenseId = null
    editDesc = expense.description
    editAmount = expense.amount
    editCurrency = expense.currency
    editDate = expense.date
    editPayerId = expense.paidByUserId
    editCategoryId = expense.categoryId
    editSliderPct = computeInitialSlider(expense)
    editError = ''
    editSaved = false
    editDeleteConfirm = false
  }

  function closeEdit() {
    expenseEditId = null
    editError = ''
    editDeleteConfirm = false
  }

  function openEditDatePicker() {
    ;(editDateInputEl as any)?.showPicker?.()
    editDateInputEl?.focus()
  }

  const editDateLabel = $derived.by(() => {
    if (!editDate) return ''
    const today = new Date().toISOString().slice(0, 10)
    return editDate === today
      ? 'Today'
      : new Date(editDate + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
  })

  async function handleSaveEdit() {
    if (!expenseEditId || editSubmitting) return
    editError = ''
    editSubmitting = true
    try {
      const splits =
        members.length === 2
          ? [
              { userId: members[0].userId, shareWeight: Math.max(1, Math.round(editSliderPct)) },
              { userId: members[1].userId, shareWeight: Math.max(1, 100 - Math.round(editSliderPct)) },
            ]
          : undefined
      await onUpdateExpense(expenseEditId, {
        description: editDesc.trim(),
        amount: editAmount,
        currency: editCurrency.trim().toUpperCase(),
        date: editDate,
        paidByUserId: editPayerId,
        splits,
        categoryId: editCategoryId,
      })
      editSaved = true
      setTimeout(() => {
        expenseEditId = null
        editSaved = false
      }, 900)
    } catch (e: any) {
      editError = e.message ?? 'Failed to save'
    } finally {
      editSubmitting = false
    }
  }

  async function handleDeleteFromEdit() {
    if (!expenseEditId || editDeleting) return
    editDeleting = true
    try {
      await onDeleteExpense(expenseEditId)
      expenseEditId = null
      editDeleteConfirm = false
    } finally {
      editDeleting = false
    }
  }

  async function confirmDeleteSettlement() {
    if (!settlementDeleteConfirmId || settlementDeleting) return
    settlementDeleting = true
    try {
      await onDeleteSettlement(settlementDeleteConfirmId)
      settlementDeleteConfirmId = null
    } finally {
      settlementDeleting = false
    }
  }

  async function handleConfirm(s: GroupSettlement) {
    const state = confirmStates[s.id]
    if (!state || !state.accountId || state.submitting) return
    state.error = ''
    state.submitting = true
    try {
      await onConfirmSettlement(s.id, state.accountId)
      state.open = false
    } catch (e: any) {
      state.error = e.message ?? 'Failed to confirm'
    } finally {
      state.submitting = false
    }
  }

  const pendingSettlements = $derived(settlements.filter((s) => s.status === 'pending'))
  const completedSettlements = $derived(settlements.filter((s) => s.status === 'completed'))
</script>

<div class="txn-panel">
  <div class="panel-tabs">
    <button
      class="panel-tab"
      class:active={panelTab === 'expenses'}
      onclick={() => (panelTab = 'expenses')}
    >
      Expenses{#if expenses.length > 0}<span class="tab-count">{expenses.length}</span>{/if}
    </button>
    <button
      class="panel-tab"
      class:active={panelTab === 'settlements'}
      onclick={() => (panelTab = 'settlements')}
    >
      Settlements{#if settlements.length > 0}<span class="tab-count">{settlements.length}</span>{/if}
    </button>
  </div>

  <div class="panel-body">
    {#if panelTab === 'expenses'}
      {#if expenses.length === 0}
        <p class="empty">No expenses yet.</p>
      {:else}
        <div class="expense-list">
          {#each expenses as expense (expense.id)}
            {@const isEditing = expenseEditId === expense.id}
            <div
              class="expense-item"
              class:expanded={expandedExpenseId === expense.id}
              class:editing={isEditing}
            >
              <div class="expense-row-wrap">
                <div
                  class="expense-row"
                  role="button"
                  tabindex="0"
                  onclick={() => {
                    if (isEditing) {
                      closeEdit()
                    } else {
                      expandedExpenseId = expandedExpenseId === expense.id ? null : expense.id
                    }
                  }}
                  onkeydown={(e) =>
                    e.key === 'Enter' &&
                    (isEditing
                      ? closeEdit()
                      : (expandedExpenseId =
                          expandedExpenseId === expense.id ? null : expense.id))}
                >
                  <div class="row-avatar">{initials(expense.payerName)}</div>
                  <div class="expense-info">
                    <div class="expense-desc-line">
                      <span class="expense-desc">{expense.description}</span>
                      {#if expense.categoryName}
                        <Chip tone="accent" size="xs" style="flex-shrink: 0"
                          >{expense.categoryName}</Chip
                        >
                      {/if}
                    </div>
                    <span class="expense-meta">{expense.date} · {expense.payerName}</span>
                  </div>
                  <div class="expense-right">
                    <span class="expense-amount">{parseFloat(expense.amount).toFixed(2)}</span>
                    <CurrencyPill code={expense.currency} />
                  </div>
                  <Icon
                    name={expandedExpenseId === expense.id || isEditing
                      ? 'chevron-up-filled'
                      : 'chevron-down-line'}
                    size={12}
                  />
                </div>
                {#if canActOnExpense(expense)}
                  <button
                    class="action-btn"
                    class:action-btn--active={isEditing}
                    onclick={() => (isEditing ? closeEdit() : openEdit(expense))}
                    aria-label={isEditing ? 'Close edit' : 'Edit expense'}
                  >
                    <Icon name="edit-txn" size={14} />
                  </button>
                {:else}
                  <span class="action-placeholder"></span>
                {/if}
              </div>

              {#if isEditing}
                <div class="edit-form">
                  <div class="edit-field">
                    <span class="field-label">Description</span>
                    <TextInput bind:value={editDesc} class="edit-input" />
                  </div>
                  <div class="edit-amount-row">
                    <div class="edit-field edit-field--amount">
                      <span class="field-label">Amount</span>
                      <TextInput
                        bind:value={editAmount}
                        type="number"
                        min="0"
                        step="0.01"
                        class="edit-input"
                      />
                    </div>
                    <div class="edit-field edit-field--currency">
                      <span class="field-label">Currency</span>
                      <CurrencyInput bind:value={editCurrency} />
                    </div>
                  </div>
                  <div class="edit-date-wrap">
                    <button class="date-chip" onclick={openEditDatePicker}>
                      <Icon name="calendar" size={12} />
                      <span class="date-chip-label">{editDateLabel}</span>
                      <Icon name="chevron-down-line" size={10} />
                    </button>
                    <input
                      bind:this={editDateInputEl}
                      type="date"
                      class="date-input-hidden"
                      bind:value={editDate}
                    />
                  </div>
                  {#if activeCategories.length > 0}
                    <div class="edit-field">
                      <span class="field-label">Category</span>
                      <div class="cat-chips">
                        {#each activeCategories as cat (cat.id)}
                          <button
                            class="cat-chip"
                            class:selected={editCategoryId === cat.id}
                            onclick={() =>
                              (editCategoryId = editCategoryId === cat.id ? null : cat.id)}
                          >
                            {cat.name}
                          </button>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  {#if members.length >= 2}
                    <div class="edit-field">
                      <span class="field-label">Paid by</span>
                      <div class="payer-chips">
                        {#each members as m (m.id)}
                          <button
                            class="payer-chip"
                            class:selected={editPayerId === m.userId}
                            onclick={() => (editPayerId = m.userId)}
                          >
                            <div class="chip-avatar" class:selected={editPayerId === m.userId}>
                              {initials(m.userName)}
                            </div>
                            <span class="chip-name">{m.userName}</span>
                          </button>
                        {/each}
                      </div>
                    </div>
                    {#if members.length === 2}
                      <div class="edit-field">
                        <span class="field-label">Split</span>
                        <div class="split-slider-labels">
                          <span class="split-name">{members[0].userName}</span>
                          <span class="split-pcts">
                            <strong>{Math.round(editSliderPct)}%</strong>
                            <span class="split-divider">/</span>
                            <strong>{Math.round(100 - editSliderPct)}%</strong>
                          </span>
                          <span class="split-name split-name--right">{members[1].userName}</span>
                        </div>
                        <input
                          type="range"
                          class="split-slider"
                          min="1"
                          max="99"
                          step="1"
                          bind:value={editSliderPct}
                        />
                      </div>
                    {/if}
                  {/if}
                  <div class="edit-actions">
                    <GradientButton onclick={closeEdit} disabled={editSubmitting}>Cancel</GradientButton>
                    <GradientButton
                      onclick={handleSaveEdit}
                      disabled={editSubmitting || !editAmount || parseFloat(editAmount) <= 0}
                    >
                      {editSubmitting ? 'Saving…' : editSaved ? '✓ Saved' : 'Save'}
                    </GradientButton>
                  </div>
                  {#if editError}
                    <span class="form-error">{editError}</span>
                  {/if}
                  {#if editDeleteConfirm}
                    {@const isImportLinked = !!expense.transactionId}
                    {@const uniqueAccountPaths = [...new Set(
                      expense.splits.map((s) => s.expenseAccountPath ?? 'uncategorized')
                    )]}
                    {@const groupAccount = allAccounts.find((a) => a.path.startsWith('group:'))}
                    <div class="delete-dialog">
                      <p class="delete-dialog-title">Delete "{expense.description}"?</p>
                      {#if isImportLinked}
                        <p class="delete-dialog-note delete-dialog-note--warn">
                          This will remove the group split <strong>and</strong> the original import transaction.
                        </p>
                      {:else}
                        <p class="delete-dialog-note">
                          {expense.splits.length} member transaction{expense.splits.length !== 1 ? 's' : ''} will be removed.
                        </p>
                      {/if}
                      <div class="delete-accounts">
                        <span class="delete-accounts-label">Accounts affected:</span>
                        <ul class="delete-accounts-list">
                          {#if isImportLinked}
                            <li class="delete-account-item delete-account-item--warn">
                              source account <span class="account-note">(original payment erased)</span>
                            </li>
                          {/if}
                          {#each uniqueAccountPaths as path}
                            <li class="delete-account-item">{path}</li>
                          {/each}
                          {#if groupAccount}
                            <li class="delete-account-item">{groupAccount.path}</li>
                          {/if}
                        </ul>
                      </div>
                      <div class="delete-dialog-actions">
                        <GradientButton
                          onclick={() => (editDeleteConfirm = false)}
                          disabled={editDeleting}
                        >Cancel</GradientButton>
                        {#if isImportLinked}
                          <GradientButton disabled>
                            Remove from group
                          </GradientButton>
                        {/if}
                        <GradientButton
                          variant="warning"
                          active
                          onclick={handleDeleteFromEdit}
                          disabled={editDeleting}
                        >{editDeleting ? 'Deleting…' : 'Delete'}</GradientButton>
                      </div>
                    </div>
                  {:else}
                    <button class="delete-link" onclick={() => (editDeleteConfirm = true)}>
                      Delete expense
                    </button>
                  {/if}
                </div>
              {:else if expandedExpenseId === expense.id}
                <div class="splits">
                  {#each expense.splits as split (split.id)}
                    <div class="split-row">
                      <span class="split-row-name">{split.userName}</span>
                      <span class="split-amount">
                        {expense.currency} {parseFloat(split.amount).toFixed(2)}
                      </span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {:else if settlements.length === 0}
      <p class="empty">No settlements recorded.</p>
    {:else}
      <div class="settlement-list">
        {#if pendingSettlements.length > 0}
          <div class="pending-header">
            <Icon name="warning-filled" size={12} />
            <span>Pending confirmation</span>
          </div>
          {#each pendingSettlements as s (s.id)}
            {@const isReceiver = s.toUserId === currentUserId}
            {@const cs = confirmStates[s.id]}
            <div class="expense-item pending-item">
              <div class="expense-row-wrap">
                <div class="expense-row settlement-row-inner">
                  <div class="row-avatar pending-avatar">{initials(s.fromUserName)}</div>
                  <div class="expense-info">
                    <span class="expense-desc">{s.fromUserName} → {s.toUserName}</span>
                    <span class="expense-meta">{s.date}{s.note ? ` · ${s.note}` : ''}</span>
                  </div>
                  <div class="expense-right">
                    <span class="expense-amount">{parseFloat(s.amount).toFixed(2)}</span>
                    <CurrencyPill code={s.currency} />
                  </div>
                </div>
                {#if canDeleteSettlement(s)}
                  <button
                    class="action-btn"
                    class:action-btn--active={settlementDeleteConfirmId === s.id}
                    onclick={() =>
                      (settlementDeleteConfirmId =
                        settlementDeleteConfirmId === s.id ? null : s.id)}
                    aria-label="Delete settlement"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                {:else}
                  <span class="action-placeholder"></span>
                {/if}
              </div>

              {#if settlementDeleteConfirmId === s.id}
                <div class="delete-confirm-bar">
                  <span class="delete-confirm-text">Are you sure?</span>
                  <GradientButton
                    onclick={() => (settlementDeleteConfirmId = null)}
                    disabled={settlementDeleting}>Cancel</GradientButton
                  >
                  <GradientButton
                    variant="warning"
                    active
                    onclick={confirmDeleteSettlement}
                    disabled={settlementDeleting}
                    >{settlementDeleting ? 'Deleting…' : 'Delete'}</GradientButton
                  >
                </div>
              {/if}

              {#if isReceiver}
                {#if cs?.open}
                  <div class="confirm-form">
                    <AccountPathInput
                      accounts={allAccounts}
                      bind:value={cs.accountId}
                      placeholder="Account received into…"
                      allowCreate={false}
                    />
                    {#if cs.error}
                      <span class="form-error">{cs.error}</span>
                    {/if}
                    <div class="confirm-actions">
                      <GradientButton onclick={() => closeConfirmForm(s.id)}>Cancel</GradientButton>
                      <GradientButton
                        onclick={() => handleConfirm(s)}
                        disabled={cs.submitting || !cs.accountId}
                      >
                        {cs.submitting ? 'Confirming…' : 'Confirm receipt'}
                      </GradientButton>
                    </div>
                  </div>
                {:else}
                  <div class="confirm-prompt">
                    <GradientButton onclick={() => openConfirmForm(s.id)}>
                      Confirm receipt
                    </GradientButton>
                  </div>
                {/if}
              {:else}
                <div class="awaiting-label">
                  Awaiting confirmation from {s.toUserName}
                </div>
              {/if}
            </div>
          {/each}
        {/if}

        {#each completedSettlements as s (s.id)}
          <div class="expense-item">
            <div class="expense-row-wrap">
              <div class="expense-row settlement-row-inner">
                <div class="row-avatar">{initials(s.fromUserName)}</div>
                <div class="expense-info">
                  <span class="expense-desc">{s.fromUserName} → {s.toUserName}</span>
                  <span class="expense-meta">{s.date}{s.note ? ` · ${s.note}` : ''}</span>
                </div>
                <div class="expense-right">
                  <span class="expense-amount">{parseFloat(s.amount).toFixed(2)}</span>
                  <CurrencyPill code={s.currency} />
                </div>
              </div>
              {#if canDeleteSettlement(s)}
                <button
                  class="action-btn"
                  class:action-btn--active={settlementDeleteConfirmId === s.id}
                  onclick={() =>
                    (settlementDeleteConfirmId =
                      settlementDeleteConfirmId === s.id ? null : s.id)}
                  aria-label="Delete settlement"
                >
                  <Icon name="trash" size={16} />
                </button>
              {:else}
                <span class="action-placeholder"></span>
              {/if}
            </div>
            {#if settlementDeleteConfirmId === s.id}
              <div class="delete-confirm-bar">
                <span class="delete-confirm-text">Are you sure?</span>
                <GradientButton
                  onclick={() => (settlementDeleteConfirmId = null)}
                  disabled={settlementDeleting}>Cancel</GradientButton
                >
                <GradientButton
                  variant="warning"
                  active
                  onclick={confirmDeleteSettlement}
                  disabled={settlementDeleting}
                  >{settlementDeleting ? 'Deleting…' : 'Delete'}</GradientButton
                >
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .txn-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--color-window-raised);
  }

  .panel-tabs {
    display: flex;
    background: var(--color-section-bar-bg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
    flex-shrink: 0;
  }

  .panel-tab {
    padding: 5px 14px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    border: none;
    border-right: 1px solid var(--color-section-bar-border-bottom);
    background: transparent;
    color: var(--color-section-bar-fg);
    opacity: 0.6;
    cursor: pointer;
    transition:
      opacity var(--duration-fast) var(--ease),
      background var(--duration-fast) var(--ease);
  }

  .panel-tab:hover:not(.active) {
    opacity: 0.85;
    background: rgba(0, 0, 0, 0.05);
  }

  .panel-tab.active {
    opacity: 1;
    background: rgba(0, 0, 0, 0.1);
    box-shadow: inset 0 -2px 0 var(--color-accent);
  }

  .tab-count {
    font-weight: 400;
    margin-left: var(--sp-xs);
    opacity: 0.7;
  }

  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: var(--color-window);
  }

  .empty {
    padding: var(--sp-lg) 22px;
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-muted);
  }

  .expense-list,
  .settlement-list {
    background: var(--color-window);
  }

  .expense-item {
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .expense-item:last-child {
    border-bottom: none;
  }

  .expense-item.expanded,
  .expense-item.editing {
    border: 1px solid var(--color-accent);
  }

  .expense-row-wrap {
    display: flex;
    align-items: stretch;
  }

  .expense-row {
    display: grid;
    grid-template-columns: auto 1fr auto 1rem;
    align-items: center;
    gap: var(--sp-xs);
    padding: 8px 8px 8px 12px;
    flex: 1;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease);
  }

  .expense-row:hover {
    background: var(--color-window-raised);
  }

  .row-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--color-accent-light);
    border: 1px solid var(--color-accent);
    color: var(--color-accent-chip-fg);
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .expense-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .expense-desc-line {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    min-width: 0;
  }

  .expense-desc {
    font-size: var(--text-sm);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }


  .expense-meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .expense-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    flex-shrink: 0;
  }

  .expense-amount {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
    font-weight: var(--weight-semibold);
  }

  .action-btn,
  .action-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    flex-shrink: 0;
  }

  .action-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-muted);
    transition:
      color var(--duration-fast) var(--ease),
      background-color var(--duration-fast) var(--ease);
  }

  .action-btn:hover,
  .action-btn--active {
    color: var(--color-accent-mid);
    background-color: var(--color-accent-light);
  }

  /* Edit form */
  .edit-form {
    padding: 10px 12px;
    background: var(--color-window-raised);
    border-top: 1px solid var(--color-accent);
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
  }

  .edit-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .field-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .edit-form :global(.edit-input) {
    width: 100%;
    box-sizing: border-box;
  }

  .edit-amount-row {
    display: flex;
    gap: var(--sp-sm);
    align-items: flex-end;
  }

  .edit-field--amount {
    flex: 1;
  }

  .edit-field--currency {
    flex-shrink: 0;
  }

  .edit-date-wrap {
    position: relative;
  }

  .date-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    background: linear-gradient(180deg, var(--color-btn-gradient-hi), var(--color-rule-soft));
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-xl);
    cursor: pointer;
    color: var(--color-text);
    white-space: nowrap;
    transition: border-color var(--duration-fast) var(--ease);
  }

  .date-chip:hover {
    border-color: var(--color-accent);
  }

  .date-chip-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .date-input-hidden {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    width: 0;
    height: 0;
    top: 0;
    left: 0;
  }

  .cat-chips {
    display: flex;
    gap: var(--sp-xs);
    flex-wrap: wrap;
  }

  .cat-chip {
    padding: 3px 9px;
    background: linear-gradient(180deg, var(--color-btn-gradient-hi), var(--color-rule-soft));
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-xl);
    cursor: pointer;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }

  .cat-chip:hover:not(.selected) {
    border-color: var(--color-accent);
  }

  .cat-chip.selected {
    background: linear-gradient(
      180deg,
      var(--color-accent),
      color-mix(in srgb, var(--color-accent) 80%, black)
    );
    border-color: var(--color-accent);
    color: var(--color-btn-gradient-hi);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
  }

  .payer-chips {
    display: flex;
    gap: var(--sp-xs);
  }

  .payer-chip {
    flex: 1;
    padding: 5px 8px;
    background: linear-gradient(180deg, var(--color-btn-gradient-hi), var(--color-rule-soft));
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-xl);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }

  .payer-chip:hover:not(.selected) {
    border-color: var(--color-accent);
  }

  .payer-chip.selected {
    background: linear-gradient(
      180deg,
      var(--color-accent),
      color-mix(in srgb, var(--color-accent) 80%, black)
    );
    border-color: var(--color-accent);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
  }

  .chip-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 7px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }

  .chip-avatar.selected {
    background: color-mix(in srgb, var(--color-accent-fg) 25%, transparent);
    border-color: color-mix(in srgb, var(--color-accent-fg) 50%, transparent);
    color: var(--color-accent-fg);
  }

  .chip-name {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color var(--duration-fast) var(--ease);
  }

  .payer-chip.selected .chip-name {
    color: var(--color-btn-gradient-hi);
  }

  .split-slider-labels {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--color-text-muted);
    margin-bottom: 2px;
  }

  .split-name {
    max-width: 70px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .split-name--right {
    text-align: right;
  }

  .split-pcts {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--color-text);
  }

  .split-divider {
    color: var(--color-text-muted);
    font-weight: 400;
  }

  .split-slider {
    width: 100%;
    cursor: pointer;
    accent-color: var(--color-accent);
  }

  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-xs);
    padding-top: var(--sp-xs);
  }

  .delete-dialog {
    margin: 0 -12px -10px;
    padding: 10px 12px;
    background: var(--color-danger-light);
    border-top: 1px solid var(--color-danger);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .delete-dialog-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-danger);
    margin: 0;
  }

  .delete-dialog-note {
    font-size: var(--text-xs);
    color: var(--color-text);
    margin: 0;
    font-family: var(--font-sans);
  }

  .delete-dialog-note--warn {
    color: var(--color-danger);
  }

  .delete-accounts {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .delete-accounts-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .delete-accounts-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .delete-account-item {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text);
    padding-left: 10px;
    position: relative;
  }

  .delete-account-item::before {
    content: '·';
    position: absolute;
    left: 2px;
    color: var(--color-text-muted);
  }

  .delete-account-item--warn {
    color: var(--color-danger);
  }

  .account-note {
    color: var(--color-text-muted);
    font-style: italic;
  }

  .delete-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-xs);
    padding-top: 4px;
  }

  .delete-link {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-danger);
    text-decoration: underline;
    text-underline-offset: 2px;
    opacity: 0.7;
    transition: opacity var(--duration-fast) var(--ease);
    align-self: flex-start;
  }

  .delete-link:hover {
    opacity: 1;
  }

  .splits {
    background: var(--color-window-raised);
  }

  .split-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 22px 5px 28px;
    border-top: 1px solid var(--color-rule-soft);
    font-size: var(--text-xs);
  }

  .split-row-name {
    color: var(--color-text-muted);
  }

  .split-amount {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
  }

  .settlement-row-inner {
    cursor: default;
  }

  /* Pending settlements */
  .pending-header {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: 4px 12px;
    background: color-mix(in srgb, #e8a000 12%, var(--color-window));
    border-bottom: 1px solid color-mix(in srgb, #e8a000 30%, transparent);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: #8a5500;
  }

  .pending-item {
    background: color-mix(in srgb, #e8a000 5%, var(--color-window));
  }

  .pending-avatar {
    background: color-mix(in srgb, #e8a000 20%, var(--color-window));
    border-color: #e8a000;
    color: #8a5500;
  }

  .confirm-prompt {
    padding: 6px 12px 8px;
    display: flex;
    justify-content: flex-end;
  }

  .confirm-form {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
    background: var(--color-window-raised);
    border-top: 1px solid var(--color-rule-soft);
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-xs);
  }

  .awaiting-label {
    padding: 5px 12px 7px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-style: italic;
  }

  .form-error {
    font-size: var(--text-xs);
    color: var(--color-amount-negative);
    font-family: var(--font-sans);
  }

  @media (max-width: 600px) {
    .txn-panel {
      height: auto;
      overflow: visible;
    }

    .panel-body {
      flex: none;
      overflow: visible;
      min-height: 0;
    }
  }
</style>
