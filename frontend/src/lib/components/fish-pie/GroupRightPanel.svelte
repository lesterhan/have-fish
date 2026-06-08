<script lang="ts">
  import type { GroupExpense, GroupSettlement, Account } from '$lib/api'
  import Icon from '$lib/components/ui/Icon.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import CurrencyPill from '../ui/CurrencyPill.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import { initials } from './utils'

  interface Props {
    expenses: GroupExpense[]
    settlements: GroupSettlement[]
    currentUserId: string
    groupId: string
    allAccounts: Account[]
    groupCreatedBy: string
    onDeleteExpense: (id: string) => Promise<void>
    onDeleteSettlement: (id: string) => Promise<void>
    onConfirmSettlement: (
      id: string,
      receiverAccountId: string,
    ) => Promise<void>
  }

  let {
    expenses,
    settlements,
    currentUserId,
    groupId,
    allAccounts,
    groupCreatedBy,
    onDeleteExpense,
    onDeleteSettlement,
    onConfirmSettlement,
  }: Props = $props()

  let panelTab = $state<'expenses' | 'settlements'>('expenses')
  let expandedExpenseId = $state<string | null>(null)
  let settlementDeleteConfirmId = $state<string | null>(null)
  let settlementDeleting = $state(false)
  let expenseDeleteConfirmId = $state<string | null>(null)
  let expenseDeleting = $state(false)

  // Per-settlement confirm state: settlementId → { accountId, submitting, error, open }
  // Never mutate this during rendering — only from event handlers.
  let confirmStates = $state<
    Record<
      string,
      { accountId: string; submitting: boolean; error: string; open: boolean }
    >
  >({})

  function openConfirmForm(id: string) {
    confirmStates[id] = {
      accountId: '',
      submitting: false,
      error: '',
      open: true,
    }
  }

  function closeConfirmForm(id: string) {
    if (confirmStates[id]) confirmStates[id].open = false
  }

  async function confirmDeleteExpense() {
    if (!expenseDeleteConfirmId || expenseDeleting) return
    expenseDeleting = true
    try {
      await onDeleteExpense(expenseDeleteConfirmId)
      expenseDeleteConfirmId = null
    } finally {
      expenseDeleting = false
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

  function canDeleteExpense(expense: GroupExpense) {
    return (
      expense.paidByUserId === currentUserId || groupCreatedBy === currentUserId
    )
  }

  function canDeleteSettlement(s: GroupSettlement) {
    return (
      s.fromUserId === currentUserId ||
      s.toUserId === currentUserId ||
      groupCreatedBy === currentUserId
    )
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

  const pendingSettlements = $derived(
    settlements.filter((s) => s.status === 'pending'),
  )
  const completedSettlements = $derived(
    settlements.filter((s) => s.status === 'completed'),
  )
</script>

<div class="txn-panel">
  <div class="panel-tabs">
    <button
      class="panel-tab"
      class:active={panelTab === 'expenses'}
      onclick={() => (panelTab = 'expenses')}
    >
      Expenses{#if expenses.length > 0}<span class="tab-count">
          {expenses.length}</span
        >{/if}
    </button>
    <button
      class="panel-tab"
      class:active={panelTab === 'settlements'}
      onclick={() => (panelTab = 'settlements')}
    >
      Settlements{#if settlements.length > 0}<span class="tab-count">
          {settlements.length}</span
        >{/if}
    </button>
  </div>

  <div class="panel-body">
    {#if panelTab === 'expenses'}
      {#if expenses.length === 0}
        <p class="empty">No expenses yet.</p>
      {:else}
        <div class="expense-list">
          {#each expenses as expense (expense.id)}
            <div
              class="expense-item"
              class:expanded={expandedExpenseId === expense.id}
            >
              <div class="expense-row-wrap">
                <div
                  class="expense-row"
                  role="button"
                  tabindex="0"
                  onclick={() =>
                    (expandedExpenseId =
                      expandedExpenseId === expense.id ? null : expense.id)}
                  onkeydown={(e) =>
                    e.key === 'Enter' &&
                    (expandedExpenseId =
                      expandedExpenseId === expense.id ? null : expense.id)}
                >
                  <div class="row-avatar">{initials(expense.payerName)}</div>
                  <div class="expense-info">
                    <span class="expense-desc">{expense.description}</span>
                    <span class="expense-meta"
                      >{expense.date} · {expense.payerName}</span
                    >
                  </div>
                  <div class="expense-right">
                    <span class="expense-amount"
                      >{parseFloat(expense.amount).toFixed(2)}</span
                    >
                    <CurrencyPill code={expense.currency} />
                  </div>
                  <Icon
                    name={expandedExpenseId === expense.id
                      ? 'chevron-up-filled'
                      : 'chevron-down-line'}
                    size={12}
                  />
                </div>
                {#if canDeleteExpense(expense)}
                  <button
                    class="delete-btn"
                    class:delete-btn--active={expenseDeleteConfirmId ===
                      expense.id}
                    onclick={() =>
                      (expenseDeleteConfirmId =
                        expenseDeleteConfirmId === expense.id
                          ? null
                          : expense.id)}
                    aria-label="Delete expense"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                {:else}
                  <span class="delete-placeholder"></span>
                {/if}
              </div>
              {#if expenseDeleteConfirmId === expense.id}
                <div class="delete-confirm-bar">
                  <span class="delete-confirm-text">Are you sure?</span>
                  <GradientButton
                    onclick={() => (expenseDeleteConfirmId = null)}
                    disabled={expenseDeleting}>Cancel</GradientButton
                  >
                  <GradientButton
                    variant="warning"
                    active
                    onclick={confirmDeleteExpense}
                    disabled={expenseDeleting}
                    >{expenseDeleting ? 'Deleting…' : 'Delete'}</GradientButton
                  >
                </div>
              {/if}
              {#if expandedExpenseId === expense.id}
                <div class="splits">
                  {#each expense.splits as split (split.id)}
                    <div class="split-row">
                      <span class="split-name">{split.userName}</span>
                      <span class="split-amount">
                        {expense.currency}
                        {parseFloat(split.amount).toFixed(2)}
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
                  <div class="row-avatar pending-avatar">
                    {initials(s.fromUserName)}
                  </div>
                  <div class="expense-info">
                    <span class="expense-desc">
                      {s.fromUserName} → {s.toUserName}
                    </span>
                    <span class="expense-meta">
                      {s.date}{s.note ? ` · ${s.note}` : ''}
                    </span>
                  </div>
                  <div class="expense-right">
                    <span class="expense-amount"
                      >{parseFloat(s.amount).toFixed(2)}</span
                    >
                    <CurrencyPill code={s.currency} />
                  </div>
                </div>
                {#if canDeleteSettlement(s)}
                  <button
                    class="delete-btn"
                    class:delete-btn--active={settlementDeleteConfirmId ===
                      s.id}
                    onclick={() =>
                      (settlementDeleteConfirmId =
                        settlementDeleteConfirmId === s.id ? null : s.id)}
                    aria-label="Delete settlement"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                {:else}
                  <span class="delete-placeholder"></span>
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
                    >{settlementDeleting
                      ? 'Deleting…'
                      : 'Delete'}</GradientButton
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
                      <GradientButton onclick={() => closeConfirmForm(s.id)}>
                        Cancel
                      </GradientButton>
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
                  <span class="expense-desc">
                    {s.fromUserName} → {s.toUserName}
                  </span>
                  <span class="expense-meta">
                    {s.date}{s.note ? ` · ${s.note}` : ''}
                  </span>
                </div>
                <div class="expense-right">
                  <span class="expense-amount"
                    >{parseFloat(s.amount).toFixed(2)}</span
                  >
                  <CurrencyPill code={s.currency} />
                </div>
              </div>
              {#if canDeleteSettlement(s)}
                <button
                  class="delete-btn"
                  class:delete-btn--active={settlementDeleteConfirmId === s.id}
                  onclick={() =>
                    (settlementDeleteConfirmId =
                      settlementDeleteConfirmId === s.id ? null : s.id)}
                  aria-label="Delete settlement"
                >
                  <Icon name="trash" size={16} />
                </button>
              {:else}
                <span class="delete-placeholder"></span>
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

  .expense-item.expanded {
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

  .delete-btn,
  .delete-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    flex-shrink: 0;
  }

  .delete-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-muted);
  }

  .delete-btn:hover,
  .delete-btn--active {
    color: var(--color-danger);
    background-color: var(--color-danger-light);
  }

  .delete-confirm-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: 5px 8px 5px 12px;
    background: var(--color-danger-light);
    border-top: 1px solid var(--color-danger);
  }

  .delete-confirm-text {
    flex: 1;
    font-size: var(--text-xs);
    color: var(--color-danger);
    font-family: var(--font-mono);
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

  .split-name {
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
