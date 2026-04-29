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
    updateGroup,
    updateMemberWeight,
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
  import Modal from '$lib/components/ui/Modal.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import CurrencyInput from '$lib/components/ui/CurrencyInput.svelte'
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
  let configCurrency = $state('')

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
  let added = $state(false)

  let expandedExpenseId = $state<string | null>(null)
  let panelTab = $state<'expenses' | 'settlements'>('expenses')

  let balances = $state<CurrencyBalance[]>([])
  let settlements = $state<GroupSettlement[]>([])

  let showSettleModal = $state(false)
  let settleFrom = $state('')
  let settleTo = $state('')
  let settleAmount = $state('')
  let settleCurrency = $state('CAD')
  let settleDate = $state(new Date().toISOString().slice(0, 10))
  let settleNote = $state('')
  let settleError = $state('')
  let settleSubmitting = $state(false)

  // share slider — member[0]'s percentage, member[1] gets the rest
  let shareSliderPct = $state(50)
  let sliderSaving = $state(false)

  // date chip
  const today = new Date().toISOString().slice(0, 10)
  let expenseDateEl = $state<HTMLInputElement | null>(null)
  const expenseDateLabel = $derived(
    expenseDate === today
      ? 'Today'
      : new Date(expenseDate + 'T00:00:00').toLocaleDateString('en-CA', {
          month: 'short',
          day: 'numeric',
        }),
  )

  const allSettled = $derived(
    balances.length === 0 || balances.every((b) => b.transfers.length === 0),
  )

  const settleFromName = $derived(
    group?.members.find((m) => m.userId === settleFrom)?.userName ?? '',
  )
  const settleToName = $derived(
    group?.members.find((m) => m.userId === settleTo)?.userName ?? '',
  )

  function initials(name: string | null | undefined): string {
    return (
      (name ?? '')
        .split(' ')
        .map((w) => w[0] ?? '')
        .join('')
        .toUpperCase()
        .slice(0, 2) || '?'
    )
  }

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
      expenseCurrency = g.defaultCurrency ?? 'CAD'
      settleCurrency = g.defaultCurrency ?? 'CAD'
      configCurrency = g.defaultCurrency ?? ''
      if (g.members.length === 2) {
        const total = g.members[0].shareWeight + g.members[1].shareWeight
        shareSliderPct =
          total > 0 ? Math.round((g.members[0].shareWeight / total) * 100) : 50
      }
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
    if (!expenseAmount || parseFloat(expenseAmount) <= 0 || expenseSubmitting)
      return
    expenseError = ''
    expenseSubmitting = true
    try {
      const expense = await createExpense(groupId, {
        description: expenseDesc.trim() || 'Expense',
        amount: expenseAmount,
        currency: expenseCurrency.trim().toUpperCase(),
        date: expenseDate,
        paidByUserId: expensePaidBy || currentUserId,
      })
      expenses = [expense, ...expenses]
      expenseDesc = ''
      expenseAmount = ''
      added = true
      await refreshBalances()
      setTimeout(() => {
        added = false
      }, 1200)
    } catch (e: any) {
      expenseError = e.message ?? 'Failed to add expense'
    } finally {
      expenseSubmitting = false
    }
  }

  async function handleDeleteExpense(expenseId: string) {
    await deleteExpense(groupId, expenseId)
    expenses = expenses.filter((e) => e.id !== expenseId)
    await refreshBalances()
  }

  function canDeleteExpense(expense: GroupExpense) {
    return (
      expense.paidByUserId === currentUserId ||
      group?.createdBy === currentUserId
    )
  }

  async function refreshBalances() {
    const [bal, sett] = await Promise.all([
      fetchBalances(groupId),
      fetchSettlements(groupId),
    ])
    balances = bal
    settlements = sett
  }

  function prefillSettle(
    fromUserId: string,
    toUserId: string,
    amount: string,
    currency: string,
  ) {
    settleFrom = fromUserId
    settleTo = toUserId
    settleAmount = amount
    settleCurrency = currency
    settleDate = new Date().toISOString().slice(0, 10)
    settleNote = ''
    settleError = ''
    showSettleModal = true
  }

  async function handleSettle() {
    if (
      !settleFrom ||
      !settleTo ||
      settleFrom === settleTo ||
      !settleAmount ||
      settleSubmitting
    )
      return
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
      showSettleModal = false
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
    return (
      s.fromUserId === currentUserId ||
      s.toUserId === currentUserId ||
      group?.createdBy === currentUserId
    )
  }

  async function saveDefaultCurrency(code: string) {
    if (!group) return
    group = await updateGroup(groupId, { defaultCurrency: code })
    expenseCurrency = code
    settleCurrency = code
  }

  function openDatePicker() {
    ;(expenseDateEl as any)?.showPicker?.()
    expenseDateEl?.focus()
  }

  async function saveShareSlider(pct: number) {
    if (!group || group.members.length !== 2 || sliderSaving) return
    sliderSaving = true
    try {
      const w0 = Math.max(1, Math.round(pct))
      const w1 = Math.max(1, 100 - w0)
      await Promise.all([
        updateMemberWeight(groupId, group.members[0].userId, w0),
        updateMemberWeight(groupId, group.members[1].userId, w1),
      ])
      group = {
        ...group,
        members: [
          { ...group.members[0], shareWeight: w0 },
          { ...group.members[1], shareWeight: w1 },
        ],
      }
    } finally {
      sliderSaving = false
    }
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
  {:else if group.members.length !== 2}
    <div class="left-col">
      <header class="page-header">
        <h1 class="page-title">{group.name}</h1>
      </header>
      <div class="left-body">
        <p class="empty">
          This view is designed for 2-member groups. Support for larger groups
          is coming soon.
        </p>
      </div>
    </div>
    <div class="right-col"></div>
  {:else}
    <div class="left-col">
      <header class="page-header">
        <h1 class="page-title">{group.name}</h1>
        <div class="header-controls">
          <CurrencyInput
            bind:value={configCurrency}
            style="width: 60px"
            oncommit={saveDefaultCurrency}
          />
          <Toggle bind:checked={showMembers} label="Balances" />
        </div>
      </header>

      <div class="left-body">
        <!-- Members (toggleable) with balances integrated -->
        {#if showMembers}
          <div class="section-bar">
            <span class="section-bar-title">Balance</span>
          </div>
          <div class="members-body">
            {#each group.members as member (member.id)}
              <div class="member-row">
                <div class="member-avatar">{initials(member.userName)}</div>
                <div class="member-info">
                  <span class="member-name">{member.userName}</span>
                  <span class="member-email">{member.userEmail}</span>
                </div>
                <div class="member-right">
                  {#each balances as cb (cb.currency)}
                    {#each cb.transfers as t}
                      {#if t.fromUserId === member.userId}
                        <span class="member-balance member-balance--owes">
                          owes {t.currency}
                          {parseFloat(t.amount).toFixed(2)}
                        </span>
                      {:else if t.toUserId === member.userId}
                        <span class="member-balance member-balance--owed">
                          gets back {t.currency}
                          {parseFloat(t.amount).toFixed(2)}
                        </span>
                      {/if}
                    {/each}
                  {/each}
                  {#if allSettled}
                    <span class="member-balance member-balance--settled"
                      >settled</span
                    >
                  {/if}
                </div>
              </div>
            {/each}
          </div>

          {#if !allSettled}
            <div class="settle-actions">
              {#each balances as cb (cb.currency)}
                {#each cb.transfers as t}
                  <div class="settle-btn-wrap">
                    <GradientButton
                      onclick={() =>
                        prefillSettle(
                          t.fromUserId,
                          t.toUserId,
                          t.amount,
                          t.currency,
                        )}
                    >
                      Settle up
                    </GradientButton>
                  </div>
                {/each}
              {/each}
            </div>
          {/if}

          {#if showInvite}
            <div class="invite-section">
              <div class="invite-form">
                <TextInput
                  bind:value={inviteEmail}
                  placeholder="Email address"
                  onkeydown={handleInviteKeydown}
                  type="email"
                />
                <GradientButton
                  onclick={handleInvite}
                  disabled={inviteSubmitting || !inviteEmail.trim()}
                >
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
                      <GradientButton
                        onclick={() => handleCancelInvite(invite.id)}
                      >
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
        <div class="section-bar">
          <span class="section-bar-title">Add Expense</span>
        </div>
        <div class="expense-form-wrap">
          <!-- Description -->
          <div class="field">
            <span class="field-label">Description</span>
            <TextInput
              bind:value={expenseDesc}
              placeholder="What was this for?"
              class="fill-input"
            />
          </div>

          <!-- Amount -->
          <div class="amount-row">
            <div class="field field-amount">
              <span class="field-label">Amount</span>
              <TextInput
                bind:value={expenseAmount}
                placeholder="0.00"
                type="number"
                min="0"
                step="0.01"
                class="fill-input amount-text"
              />
            </div>
          </div>

          <!-- Date chip -->
          <div class="date-chip-outer">
            <div class="field">
              <div class="date-chip-wrap">
                <button class="date-chip" onclick={openDatePicker}>
                  <span class="date-chip-icon">📅</span>
                  <span class="date-chip-label">{expenseDateLabel}</span>
                  <Icon name="chevron-down" size={10} />
                </button>
                <input
                  bind:this={expenseDateEl}
                  type="date"
                  class="date-input-hidden"
                  bind:value={expenseDate}
                />
              </div>
            </div>
          </div>

          <!-- Paid by chips -->
          <div class="field">
            <span class="field-label">Paid by</span>
            <div class="payer-chips">
              {#each group.members as m, i (m.id)}
                {@const pct =
                  i === 0
                    ? Math.round(shareSliderPct)
                    : Math.round(100 - shareSliderPct)}
                {@const selected = expensePaidBy === m.userId}
                <button
                  class="payer-chip"
                  class:selected
                  onclick={() => (expensePaidBy = m.userId)}
                >
                  <div class="chip-avatar" class:selected>
                    {initials(m.userName)}
                  </div>
                  <div class="chip-info">
                    <span class="chip-name">{m.userName}</span>
                    <span class="chip-share">{pct}% share</span>
                  </div>
                </button>
              {/each}
            </div>
          </div>

          <!-- Share split slider -->
          <div class="share-slider-wrap">
            <div class="share-slider-labels">
              <span class="share-slider-name">{group.members[0].userName}</span>
              <span class="share-slider-pcts">
                <span>{Math.round(shareSliderPct)}%</span>
                <span class="share-slider-divider">/</span>
                <span>{Math.round(100 - shareSliderPct)}%</span>
              </span>
              <span class="share-slider-name share-slider-name--right"
                >{group.members[1].userName}</span
              >
            </div>
            <input
              type="range"
              class="share-slider-track"
              min="1"
              max="99"
              step="1"
              bind:value={shareSliderPct}
              onchange={() => saveShareSlider(shareSliderPct)}
            />
          </div>

          <!-- Add button -->
          <div class="add-cta">
            <GradientButton
              active={added}
              onclick={handleAddExpense}
              disabled={expenseSubmitting ||
                !expenseAmount ||
                parseFloat(expenseAmount) <= 0}
            >
              {added ? '✓ Added' : 'Add Expense'}
            </GradientButton>
          </div>

          {#if expenseError}
            <span class="form-error">{expenseError}</span>
          {/if}
        </div>
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
                            expandedExpenseId === expense.id
                              ? null
                              : expense.id)}
                        onkeydown={(e) =>
                          e.key === 'Enter' &&
                          (expandedExpenseId =
                            expandedExpenseId === expense.id
                              ? null
                              : expense.id)}
                      >
                        <div class="row-avatar">
                          {initials(expense.payerName)}
                        </div>
                        <div class="expense-info">
                          <span class="expense-desc">{expense.description}</span
                          >
                          <span class="expense-meta"
                            >{expense.date} · {expense.payerName}</span
                          >
                        </div>
                        <div class="expense-right">
                          <span class="expense-amount"
                            >{parseFloat(expense.amount).toFixed(2)}</span
                          >
                          <span class="expense-currency"
                            >{expense.currency}</span
                          >
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
                          onclick={() => handleDeleteExpense(expense.id)}
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
                      onclick={() => handleDeleteSettlement(s.id)}
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
    </div>
  {/if}
</div>

<Modal
  title="Settle up"
  bind:open={showSettleModal}
  onclose={() => (settleError = '')}
>
  <div class="settle-modal">
    <div class="settle-modal-summary">
      <span class="settle-modal-name">{settleFromName}</span>
      <span class="settle-modal-arrow">→</span>
      <span class="settle-modal-name">{settleToName}</span>
    </div>
    <div class="settle-modal-amount-row">
      <TextInput
        bind:value={settleAmount}
        placeholder="0.00"
        type="number"
        min="0"
        step="0.01"
        class="settle-modal-amount"
      />
      <span class="settle-modal-currency">{settleCurrency}</span>
    </div>
    <TextInput bind:value={settleDate} type="date" class="settle-modal-date" />
    <TextInput
      bind:value={settleNote}
      placeholder="Note (optional)"
      class="settle-modal-note"
    />
    {#if settleError}
      <span class="form-error">{settleError}</span>
    {/if}
    <div class="settle-modal-actions">
      <GradientButton
        onclick={() => {
          showSettleModal = false
          settleError = ''
        }}
      >
        Cancel
      </GradientButton>
      <GradientButton
        onclick={handleSettle}
        disabled={settleSubmitting || !settleAmount}
      >
        Record
      </GradientButton>
    </div>
  </div>
</Modal>

<style>
  .page {
    display: grid;
    grid-template-columns: 1fr 360px;
    height: 100%;
    overflow: hidden;
  }

  /* ====================================================================
     Left column
     ==================================================================== */
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

  .header-placeholder {
    height: 28px;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

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

  /* ====================================================================
     Members
     ==================================================================== */
  .members-body {
    background: var(--color-window);
  }

  .member-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 8px 22px;
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .member-row:last-child {
    border-bottom: none;
  }

  .member-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--color-accent-light);
    border: 1px solid var(--color-accent);
    color: var(--color-accent-chip-fg);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .member-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .member-name {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .member-email {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .member-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    flex-shrink: 0;
  }

  .member-balance {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .member-balance--owes {
    color: var(--color-amount-negative);
  }

  .member-balance--owed {
    color: var(--color-amount-positive);
  }

  .member-balance--settled {
    color: var(--color-text-muted);
    font-weight: 400;
    font-style: italic;
  }

  /* ====================================================================
     Settle actions (inside members panel)
     ==================================================================== */
  .settle-actions {
    background: var(--color-window);
    border-top: 1px solid var(--color-rule-soft);
    padding: var(--sp-xs) 22px;
  }

  .settle-btn-wrap :global(.btn) {
    width: 100%;
    height: 32px;
    font-size: var(--text-sm);
  }

  /* ====================================================================
     Invite
     ==================================================================== */
  .invite-section {
    background: var(--color-window);
  }

  .invite-form {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-xs) 22px;
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .invite-form :global(.text-input) {
    width: 240px;
  }

  .pending-list {
    border-top: 1px solid var(--color-rule-soft);
  }

  .pending-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 6px 22px;
    border-bottom: 1px solid var(--color-rule-soft);
    font-size: var(--text-sm);
  }

  .pending-row:last-child {
    border-bottom: none;
  }

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

  /* ====================================================================
     Expense form
     ==================================================================== */
  .expense-form-wrap {
    background: var(--color-window);
    padding: 12px 22px;
    border-bottom: 1px solid var(--color-rule);
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .expense-form-wrap :global(.fill-input) {
    width: 100%;
    box-sizing: border-box;
  }

  .amount-row {
    display: flex;
    align-items: flex-end;
  }

  .field-amount {
    flex: 1;
    min-width: 0;
  }

  .date-chip-outer {
    display: flex;
  }

  .expense-form-wrap :global(.amount-text) {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    height: 64px;
  }

  /* ====================================================================
     Date chip
     ==================================================================== */
  .date-chip-wrap {
    position: relative;
  }

  .date-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    background: linear-gradient(
      180deg,
      var(--color-btn-gradient-hi),
      var(--color-rule-soft)
    );
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

  .date-chip-icon {
    font-size: 12px;
    line-height: 1;
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

  /* ====================================================================
     Payer chips
     ==================================================================== */
  .payer-chips {
    display: flex;
    gap: var(--sp-xs);
    flex-wrap: wrap;
  }

  .payer-chip {
    flex: 1;
    min-width: 100px;
    padding: 8px 12px;
    background: linear-gradient(
      180deg,
      var(--color-btn-gradient-hi),
      var(--color-rule-soft)
    );
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-xl);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .payer-chip:hover:not(.selected) {
    background: linear-gradient(
      180deg,
      var(--color-btn-gradient-hi),
      var(--color-accent-chip-bg)
    );
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
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }

  .chip-avatar.selected {
    background: color-mix(in srgb, var(--color-accent-fg) 25%, transparent);
    border-color: color-mix(in srgb, var(--color-accent-fg) 50%, transparent);
    color: var(--color-accent-fg);
  }

  .chip-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: left;
    min-width: 0;
  }

  .chip-name {
    font-size: var(--text-sm);
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

  .chip-share {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--color-text-muted);
    transition: color var(--duration-fast) var(--ease);
  }

  .payer-chip.selected .chip-share {
    color: color-mix(in srgb, var(--color-accent-fg) 65%, transparent);
  }

  /* ====================================================================
     Share split slider
     ==================================================================== */
  .share-slider-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .share-slider-labels {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--color-text-muted);
  }

  .share-slider-name {
    width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .share-slider-name--right {
    text-align: right;
  }

  .share-slider-pcts {
    display: flex;
    align-items: center;
    gap: 3px;
    font-weight: 700;
    color: var(--color-text);
  }

  .share-slider-divider {
    color: var(--color-text-muted);
    font-weight: 400;
  }

  .share-slider-track {
    width: 100%;
    cursor: pointer;
    accent-color: var(--color-accent);
  }

  /* ====================================================================
     Add Expense button
     ==================================================================== */
  .add-cta :global(.btn) {
    width: 100%;
    height: 36px;
    font-size: var(--text-sm);
  }

  .form-error {
    font-size: var(--text-xs);
    color: var(--color-amount-negative);
    font-family: var(--font-sans);
    display: block;
  }

  /* ====================================================================
     Settle modal
     ==================================================================== */
  .settle-modal {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    min-width: 280px;
  }

  .settle-modal-summary {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window);
    box-shadow: var(--shadow-sunken);
    font-size: var(--text-sm);
  }

  .settle-modal-name {
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .settle-modal-arrow {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .settle-modal-amount-row {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .settle-modal :global(.settle-modal-amount) {
    flex: 1;
  }

  .settle-modal-currency {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--color-text-muted);
    min-width: 32px;
  }

  .settle-modal :global(.settle-modal-date),
  .settle-modal :global(.settle-modal-note) {
    width: 100%;
    box-sizing: border-box;
  }

  .settle-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-xs);
    padding-top: var(--sp-xs);
  }

  .empty {
    padding: var(--sp-lg) 22px;
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-muted);
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

  /* ====================================================================
     Right column — transaction panel
     ==================================================================== */
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

  /* ====================================================================
     Expense list (right panel)
     ==================================================================== */
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

  /* ====================================================================
     Splits (expanded)
     ==================================================================== */
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

  /* ====================================================================
     Settlement history (right panel)
     ==================================================================== */
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

  /* ====================================================================
     Responsive — mobile
     ==================================================================== */
  @media (max-width: 600px) {
    .page {
      display: flex;
      flex-direction: column;
      height: auto;
      overflow: visible;
    }

    .left-col {
      overflow: visible;
      border-right: none;
      border-bottom: 1px solid var(--color-rule);
    }

    .left-body {
      flex: none;
      overflow: visible;
      min-height: 0;
    }

    .right-col {
      flex: none;
    }

    .txn-panel {
      height: auto;
      overflow: visible;
    }

    .panel-body {
      flex: none;
      overflow: visible;
      min-height: 0;
    }

    .page-header {
      padding: 10px 14px 8px;
      flex-wrap: wrap;
    }

    .expense-form-wrap {
      padding: 10px 14px;
    }

    .amount-row {
      flex-wrap: wrap;
    }

    .member-row,
    .invite-form,
    .pending-row {
      padding-left: 14px;
      padding-right: 14px;
    }

    .payer-chips {
      gap: var(--sp-xs);
    }

    .payer-chip {
      min-width: 80px;
    }
  }
</style>
