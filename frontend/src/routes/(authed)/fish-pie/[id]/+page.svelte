<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import {
    fetchGroup,
    fetchGroupInvites,
    sendInvite,
    cancelInvite,
    fetchExpenses,
    createExpense,
    deleteExpense,
    fetchBalances,
    fetchSettlements,
    createSettlement,
    deleteSettlement,
  } from '$lib/api'
  import type {
    ExpenseGroup,
    GroupInvite,
    GroupExpense,
    CurrencyBalance,
    GroupSettlement,
  } from '$lib/api'
  import { useSession } from '$lib/auth'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import Toggle from '$lib/components/ui/Toggle.svelte'

  const groupId = $derived(page.params.id ?? '')
  const session = useSession()
  const currentUserId = $derived($session.data?.user.id ?? '')

  let group = $state<ExpenseGroup | null>(null)
  let invites = $state<GroupInvite[]>([])
  let expenses = $state<GroupExpense[]>([])
  let loading = $state(true)
  let notFound = $state(false)

  let showMembers = $state(false)
  let showInvite = $state(false)
  let inviteEmail = $state('')
  let inviteError = $state('')
  let inviteSubmitting = $state(false)

  let expenseDesc = $state('')
  let expenseAmount = $state('')
  let expenseCurrency = $state('CAD')
  let expenseDate = $state(new Date().toISOString().slice(0, 10))
  let expensePaidBy = $state('')
  let expenseError = $state('')
  let expenseSubmitting = $state(false)

  let expandedExpenseId = $state<string | null>(null)

  let balances = $state<CurrencyBalance[]>([])
  let settlements = $state<GroupSettlement[]>([])

  let panelTab = $state<'expenses' | 'settlements'>('expenses')

  let showSettleForm = $state(false)
  let settleFrom = $state('')
  let settleTo = $state('')
  let settleAmount = $state('')
  let settleCurrency = $state('CAD')
  let settleDate = $state(new Date().toISOString().slice(0, 10))
  let settleNote = $state('')
  let settleError = $state('')
  let settleSubmitting = $state(false)

  onMount(async () => {
    try {
      const [g, inv, exp, bal, sett] = await Promise.all([
        fetchGroup(groupId),
        fetchGroupInvites(groupId),
        fetchExpenses(groupId),
        fetchBalances(groupId),
        fetchSettlements(groupId),
      ])
      group = g
      invites = inv
      expenses = exp
      balances = bal
      settlements = sett
      expensePaidBy = currentUserId
      settleFrom = currentUserId
    } catch {
      notFound = true
    } finally {
      loading = false
    }
  })

  async function handleInvite() {
    if (!inviteEmail.trim() || inviteSubmitting) return
    inviteError = ''
    inviteSubmitting = true
    try {
      const invite = await sendInvite(groupId, inviteEmail.trim())
      invites = [...invites, invite]
      inviteEmail = ''
    } catch (e: any) {
      inviteError = e.message ?? 'Failed to send invite'
    } finally {
      inviteSubmitting = false
    }
  }

  async function handleCancelInvite(inviteId: string) {
    await cancelInvite(groupId, inviteId)
    invites = invites.filter((i) => i.id !== inviteId)
  }

  function handleInviteKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleInvite()
  }

  async function handleAddExpense() {
    if (!expenseDesc.trim() || !expenseAmount || expenseSubmitting) return
    expenseError = ''
    expenseSubmitting = true
    try {
      const expense = await createExpense(groupId, {
        description: expenseDesc.trim(),
        amount: expenseAmount,
        currency: expenseCurrency.trim().toUpperCase(),
        date: expenseDate,
        paidByUserId: expensePaidBy || currentUserId,
      })
      expenses = [expense, ...expenses]
      expenseDesc = ''
      expenseAmount = ''
    } catch (e: any) {
      expenseError = e.message ?? 'Failed to add expense'
    } finally {
      expenseSubmitting = false
    }
  }

  async function handleDeleteExpense(expenseId: string) {
    await deleteExpense(groupId, expenseId)
    expenses = expenses.filter((e) => e.id !== expenseId)
  }

  function canDeleteExpense(expense: GroupExpense) {
    return expense.paidByUserId === currentUserId || group?.createdBy === currentUserId
  }

  async function refreshBalances() {
    const [bal, sett] = await Promise.all([fetchBalances(groupId), fetchSettlements(groupId)])
    balances = bal
    settlements = sett
  }

  function prefillSettle(fromUserId: string, toUserId: string, amount: string, currency: string) {
    settleFrom = fromUserId
    settleTo = toUserId
    settleAmount = amount
    settleCurrency = currency
    showSettleForm = true
  }

  async function handleSettle() {
    if (!settleFrom || !settleTo || !settleAmount || settleSubmitting) return
    settleError = ''
    settleSubmitting = true
    try {
      await createSettlement(groupId, {
        fromUserId: settleFrom,
        toUserId: settleTo,
        amount: settleAmount,
        currency: settleCurrency,
        date: settleDate,
        note: settleNote.trim() || undefined,
      })
      settleAmount = ''
      settleNote = ''
      showSettleForm = false
      await refreshBalances()
    } catch (e: any) {
      settleError = e.message ?? 'Failed to record settlement'
    } finally {
      settleSubmitting = false
    }
  }

  async function handleDeleteSettlement(settlementId: string) {
    await deleteSettlement(groupId, settlementId)
    await refreshBalances()
  }

  function canDeleteSettlement(s: GroupSettlement) {
    return s.fromUserId === currentUserId || s.toUserId === currentUserId || group?.createdBy === currentUserId
  }
</script>

<div class="page">
  {#if loading}
    <div class="left-col">
      <header class="page-header">
        <div class="header-placeholder"></div>
      </header>
    </div>
    <div class="right-col"></div>
  {:else if notFound || !group}
    <div class="left-col">
      <header class="page-header">
        <h1 class="page-title">Group not found</h1>
      </header>
    </div>
    <div class="right-col"></div>
  {:else}
    <div class="left-col">
      <header class="page-header">
        <h1 class="page-title">{group.name}</h1>
        <Toggle bind:checked={showMembers} label="Show members" />
      </header>

      <div class="left-body">
        <!-- Members (toggleable) -->
        {#if showMembers}
          <div class="section-bar">
            <span class="section-bar-title">Members</span>
            <GradientButton onclick={() => { showInvite = !showInvite; inviteEmail = ''; inviteError = '' }}>
              <Icon name="plus" size={12} /> Invite
            </GradientButton>
          </div>
          <div class="members-body">
            {#each group.members as member (member.id)}
              <div class="member-row">
                <span class="member-name">{member.userName}</span>
                <span class="member-email">{member.userEmail}</span>
                <span class="member-weight">{member.shareWeight}</span>
              </div>
            {/each}
          </div>
          {#if showInvite}
            <div class="invite-section">
              <div class="invite-form">
                <TextInput
                  bind:value={inviteEmail}
                  placeholder="Email address"
                  onkeydown={handleInviteKeydown}
                  type="email"
                />
                <GradientButton onclick={handleInvite} disabled={inviteSubmitting || !inviteEmail.trim()}>
                  Send invite
                </GradientButton>
                {#if inviteError}
                  <span class="form-error">{inviteError}</span>
                {/if}
              </div>
              {#if invites.length > 0}
                <div class="pending-list">
                  {#each invites as invite (invite.id)}
                    <div class="pending-row">
                      <span class="pending-email">{invite.inviteeEmail}</span>
                      <span class="pending-label">Pending</span>
                      <GradientButton onclick={() => handleCancelInvite(invite.id)}>
                        <Icon name="x" size={10} /> Cancel
                      </GradientButton>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        {/if}

        <!-- Expense entry -->
        <div class="section-bar"><span class="section-bar-title">Add Expense</span></div>
        <div class="expense-form-wrap">
          <div class="expense-form">
            <TextInput bind:value={expenseDesc} placeholder="Description" class="desc-input" />
            <TextInput bind:value={expenseAmount} placeholder="0.00" class="amount-input" type="number" min="0" step="0.01" />
            <TextInput bind:value={expenseCurrency} placeholder="CAD" class="currency-input" />
            <TextInput bind:value={expenseDate} type="date" class="date-input" />
            <select class="paid-by-select" bind:value={expensePaidBy}>
              {#each group.members as m (m.id)}
                <option value={m.userId}>{m.userName}</option>
              {/each}
            </select>
            <GradientButton onclick={handleAddExpense} disabled={expenseSubmitting || !expenseDesc.trim() || !expenseAmount}>
              Add
            </GradientButton>
          </div>
          {#if expenseError}
            <span class="form-error">{expenseError}</span>
          {/if}
        </div>

        <!-- Balances -->
        <div class="section-bar">
          <span class="section-bar-title">Balances</span>
          <GradientButton onclick={() => { showSettleForm = !showSettleForm; settleError = '' }}>
            <Icon name="plus" size={12} /> Record settlement
          </GradientButton>
        </div>

        {#if showSettleForm}
          <div class="settle-form-wrap">
            <div class="settle-form">
              <select class="paid-by-select" bind:value={settleFrom}>
                {#each group.members as m (m.id)}
                  <option value={m.userId}>{m.userName}</option>
                {/each}
              </select>
              <span class="settle-arrow">→</span>
              <select class="paid-by-select" bind:value={settleTo}>
                {#each group.members as m (m.id)}
                  <option value={m.userId}>{m.userName}</option>
                {/each}
              </select>
              <TextInput bind:value={settleAmount} placeholder="0.00" type="number" min="0" step="0.01" class="settle-amount" />
              <TextInput bind:value={settleCurrency} placeholder="CAD" class="settle-currency" />
              <TextInput bind:value={settleDate} type="date" class="settle-date" />
              <TextInput bind:value={settleNote} placeholder="Note (optional)" class="settle-note" />
              <GradientButton onclick={handleSettle} disabled={settleSubmitting || !settleFrom || !settleTo || !settleAmount}>
                Save
              </GradientButton>
            </div>
            {#if settleError}
              <span class="form-error">{settleError}</span>
            {/if}
          </div>
        {/if}

        {#if balances.length === 0 || balances.every((b) => b.transfers.length === 0)}
          <p class="empty">All settled up.</p>
        {:else}
          <div class="balances-body">
            {#each balances as cb (cb.currency)}
              {#each cb.transfers as t}
                <div class="transfer-row">
                  <span class="transfer-names">
                    <span class="transfer-from">{t.fromUserName}</span>
                    <span class="transfer-arrow">→</span>
                    <span class="transfer-to">{t.toUserName}</span>
                  </span>
                  <span class="transfer-amount">{t.currency} {parseFloat(t.amount).toFixed(2)}</span>
                  <GradientButton onclick={() => prefillSettle(t.fromUserId, t.toUserId, t.amount, t.currency)}>
                    Settle up
                  </GradientButton>
                </div>
              {/each}
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Right panel: expense list + settlement history tabs -->
    <div class="right-col">
      <div class="txn-panel">
        <div class="panel-tabs">
          <button
            class="panel-tab"
            class:active={panelTab === 'expenses'}
            onclick={() => (panelTab = 'expenses')}
          >
            Expenses {#if expenses.length > 0}<span class="tab-count">{expenses.length}</span>{/if}
          </button>
          <button
            class="panel-tab"
            class:active={panelTab === 'settlements'}
            onclick={() => (panelTab = 'settlements')}
          >
            Settlements {#if settlements.length > 0}<span class="tab-count">{settlements.length}</span>{/if}
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
                        onclick={() => (expandedExpenseId = expandedExpenseId === expense.id ? null : expense.id)}
                        onkeydown={(e) => e.key === 'Enter' && (expandedExpenseId = expandedExpenseId === expense.id ? null : expense.id)}
                      >
                        <span class="expense-date">{expense.date}</span>
                        <span class="expense-desc">{expense.description}</span>
                        <span class="expense-payer">{expense.payerName}</span>
                        <span class="expense-amount">{expense.currency} {parseFloat(expense.amount).toFixed(2)}</span>
                        <Icon name={expandedExpenseId === expense.id ? 'chevron-up' : 'chevron-down'} size={12} />
                      </div>
                      {#if canDeleteExpense(expense)}
                        <button class="delete-btn" onclick={() => handleDeleteExpense(expense.id)} aria-label="Delete expense">
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
                            <span class="split-amount">{expense.currency} {parseFloat(split.amount).toFixed(2)}</span>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          {:else}
            {#if settlements.length === 0}
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
                    <span class="settlement-amount">{s.currency} {parseFloat(s.amount).toFixed(2)}</span>
                    {#if s.note}
                      <span class="settlement-note">{s.note}</span>
                    {/if}
                    {#if canDeleteSettlement(s)}
                      <button class="delete-btn" onclick={() => handleDeleteSettlement(s.id)} aria-label="Delete settlement">
                        <Icon name="x" size={10} />
                      </button>
                    {:else}
                      <span class="delete-placeholder"></span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    display: grid;
    grid-template-columns: 1fr 360px;
    height: 100%;
    overflow: hidden;
  }

  /* Left column */
  .left-col {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--color-rule);
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: 14px 22px 10px;
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule);
    flex-shrink: 0;
  }

  .header-placeholder { height: 28px; }

  .page-title {
    font-family: var(--font-serif);
    font-size: 24px;
    font-weight: 600;
    color: var(--color-text);
    line-height: var(--leading-tight);
    margin: 0;
    letter-spacing: -0.2px;
    flex: 1;
  }

  .left-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: var(--color-window-raised);
  }

  .section-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 14px;
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }

  /* Members */
  .members-body { background: var(--color-window); }

  .member-row {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: 8px 22px;
    border-bottom: 1px solid var(--color-rule-soft);
    font-size: var(--text-sm);
  }

  .member-row:last-child { border-bottom: none; }

  .member-name {
    font-weight: var(--weight-semibold);
    color: var(--color-text);
    min-width: 120px;
  }

  .member-email {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    flex: 1;
  }

  .member-weight {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* Invite */
  .invite-section { background: var(--color-window); }

  .invite-form {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-xs) 22px;
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .invite-form :global(.text-input) { width: 240px; }

  .pending-list { border-top: 1px solid var(--color-rule-soft); }

  .pending-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 6px 22px;
    border-bottom: 1px solid var(--color-rule-soft);
    font-size: var(--text-sm);
  }

  .pending-row:last-child { border-bottom: none; }

  .pending-email {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text);
  }

  .pending-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* Expense form */
  .expense-form-wrap {
    background: var(--color-window);
    padding: var(--sp-xs) 22px;
    border-bottom: 1px solid var(--color-rule);
  }

  .expense-form {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    flex-wrap: wrap;
  }

  .expense-form :global(.desc-input) { flex: 1; min-width: 0; }
  .expense-form :global(.amount-input) { width: 80px; }
  .expense-form :global(.currency-input) { width: 52px; }
  .expense-form :global(.date-input) { width: 120px; }

  .paid-by-select {
    height: 24px;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
    padding: 0 var(--sp-xs);
    box-sizing: border-box;
  }

  .form-error {
    font-size: var(--text-xs);
    color: var(--color-amount-negative);
    font-family: var(--font-sans);
    display: block;
    margin-top: 4px;
  }

  /* Balances */
  .balances-body { background: var(--color-window); }

  .transfer-row {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: 8px 22px;
    border-bottom: 1px solid var(--color-rule-soft);
    font-size: var(--text-sm);
  }

  .transfer-row:last-child { border-bottom: none; }

  .transfer-names {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    flex: 1;
  }

  .transfer-from { font-weight: var(--weight-semibold); color: var(--color-text); }
  .transfer-arrow { color: var(--color-text-muted); font-size: var(--text-xs); }
  .transfer-to { color: var(--color-text); }

  .transfer-amount {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--color-amount-negative);
  }

  /* Settlement form */
  .settle-form-wrap {
    background: var(--color-window);
    padding: var(--sp-xs) 22px;
    border-bottom: 1px solid var(--color-rule);
  }

  .settle-form {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    flex-wrap: wrap;
  }

  .settle-arrow {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .settle-form :global(.settle-amount) { width: 80px; }
  .settle-form :global(.settle-currency) { width: 52px; }
  .settle-form :global(.settle-date) { width: 120px; }
  .settle-form :global(.settle-note) { flex: 1; min-width: 120px; }

  .empty {
    padding: var(--sp-lg) 22px;
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-muted);
  }

  /* Right column — transaction panel */
  .right-col {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

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
    opacity: 0.7;
  }

  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: var(--color-window);
  }

  /* Expense list */
  .expense-list { background: var(--color-window); }

  .expense-item { border-bottom: 1px solid var(--color-rule-soft); }
  .expense-item:last-child { border-bottom: none; }

  .expense-row-wrap {
    display: flex;
    align-items: center;
  }

  .expense-row {
    display: grid;
    grid-template-columns: 6rem 1fr 6rem 6rem 1rem;
    align-items: center;
    gap: var(--sp-xs);
    padding: 7px 8px 7px 14px;
    flex: 1;
    cursor: pointer;
    font-family: var(--font-sans);
    transition: background var(--duration-fast) var(--ease);
  }

  .expense-row:hover { background: var(--color-window-raised); }

  .expense-date {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .expense-desc {
    font-size: var(--text-sm);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .expense-payer {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .expense-amount {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .delete-btn, .delete-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    flex-shrink: 0;
  }

  .delete-btn {
    height: 100%;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-muted);
    transition: color var(--duration-fast) var(--ease);
  }

  .delete-btn:hover { color: var(--color-amount-negative); }

  /* Splits */
  .splits { background: var(--color-window-raised); }

  .split-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 22px 5px 28px;
    border-top: 1px solid var(--color-rule-soft);
    font-size: var(--text-xs);
  }

  .split-name {
    font-family: var(--font-sans);
    color: var(--color-text-muted);
  }

  .split-amount {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* Settlement history */
  .settlement-list { background: var(--color-window); }

  .settlement-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 6px 8px 6px 14px;
    border-bottom: 1px solid var(--color-rule-soft);
    font-size: var(--text-sm);
  }

  .settlement-row:last-child { border-bottom: none; }

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
    font-variant-numeric: tabular-nums;
    color: var(--color-text);
  }

  .settlement-note {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-style: italic;
    flex: 1;
  }
</style>
