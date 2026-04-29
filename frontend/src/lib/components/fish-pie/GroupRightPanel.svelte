<script lang="ts">
  import type { GroupExpense, GroupSettlement } from '$lib/api'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { initials } from './utils'

  interface Props {
    expenses: GroupExpense[]
    settlements: GroupSettlement[]
    currentUserId: string
    groupCreatedBy: string
    onDeleteExpense: (id: string) => Promise<void>
    onDeleteSettlement: (id: string) => Promise<void>
  }

  let {
    expenses,
    settlements,
    currentUserId,
    groupCreatedBy,
    onDeleteExpense,
    onDeleteSettlement,
  }: Props = $props()

  let panelTab = $state<'expenses' | 'settlements'>('expenses')
  let expandedExpenseId = $state<string | null>(null)

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
            <div class="expense-item">
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
                    <span class="expense-currency">{expense.currency}</span>
                  </div>
                  <Icon
                    name={expandedExpenseId === expense.id
                      ? 'chevron-up'
                      : 'chevron-down'}
                    size={12}
                  />
                </div>
                {#if canDeleteExpense(expense)}
                  <button
                    class="delete-btn"
                    onclick={() => onDeleteExpense(expense.id)}
                    aria-label="Delete expense"
                  >
                    <Icon name="x" size={10} />
                  </button>
                {:else}
                  <span class="delete-placeholder"></span>
                {/if}
              </div>
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
        {#each settlements as s (s.id)}
          <div class="settlement-row">
            <span class="settlement-date">{s.date}</span>
            <span class="settlement-names">
              <span class="transfer-from">{s.fromUserName}</span>
              <span class="transfer-arrow">→</span>
              <span class="transfer-to">{s.toUserName}</span>
            </span>
            <span class="settlement-amount">
              {s.currency}
              {parseFloat(s.amount).toFixed(2)}
            </span>
            {#if s.note}
              <span class="settlement-note">{s.note}</span>
            {/if}
            {#if canDeleteSettlement(s)}
              <button
                class="delete-btn"
                onclick={() => onDeleteSettlement(s.id)}
                aria-label="Delete settlement"
              >
                <Icon name="x" size={10} />
              </button>
            {:else}
              <span class="delete-placeholder"></span>
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

  .expense-list {
    background: var(--color-window);
  }

  .expense-item {
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .expense-item:last-child {
    border-bottom: none;
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

  .expense-currency {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
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
    transition: color var(--duration-fast) var(--ease);
  }

  .delete-btn:hover {
    color: var(--color-amount-negative);
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

  .settlement-list {
    background: var(--color-window);
  }

  .settlement-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 6px 8px 6px 14px;
    border-bottom: 1px solid var(--color-rule-soft);
    font-size: var(--text-sm);
  }

  .settlement-row:last-child {
    border-bottom: none;
  }

  .settlement-date {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    min-width: 6rem;
  }

  .settlement-names {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    flex: 1;
  }

  .settlement-amount {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .settlement-note {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-style: italic;
    flex: 1;
  }

  .transfer-from {
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .transfer-arrow {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .transfer-to {
    color: var(--color-text);
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
