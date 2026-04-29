<script lang="ts">
  import { onMount } from "svelte"
  import { page } from "$app/state"
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
  } from "$lib/api"
  import type {
    ExpenseGroup,
    GroupInvite,
    GroupExpense,
    CurrencyBalance,
    GroupSettlement,
  } from "$lib/api"
  import { useSession } from "$lib/auth"
  import GradientButton from "$lib/components/ui/GradientButton.svelte"
  import TextInput from "$lib/components/ui/TextInput.svelte"
  import CurrencyInput from "$lib/components/ui/CurrencyInput.svelte"
  import Icon from "$lib/components/ui/Icon.svelte"
  import Toggle from "$lib/components/ui/Toggle.svelte"

  const groupId = $derived(page.params.id ?? "")
  const session = useSession()
  const currentUserId = $derived($session.data?.user.id ?? "")

  let group = $state<ExpenseGroup | null>(null)
  let invites = $state<GroupInvite[]>([])
  let expenses = $state<GroupExpense[]>([])
  let loading = $state(true)
  let notFound = $state(false)

  let showMembers = $state(false)
  let showConfig = $state(false)
  let configCurrency = $state("")
  let shareSliders = $state<Record<string, number>>({})
  let weightSaving = $state(false)

  let showInvite = $state(false)
  let inviteEmail = $state("")
  let inviteError = $state("")
  let inviteSubmitting = $state(false)

  let expenseDesc = $state("")
  let expenseAmount = $state("")
  let expenseCurrency = $state("CAD")
  let expenseDate = $state(new Date().toISOString().slice(0, 10))
  let expensePaidBy = $state("")
  let expenseError = $state("")
  let expenseSubmitting = $state(false)
  let added = $state(false)

  let expandedExpenseId = $state<string | null>(null)
  let panelTab = $state<"expenses" | "settlements">("expenses")

  let balances = $state<CurrencyBalance[]>([])
  let settlements = $state<GroupSettlement[]>([])

  let showSettleForm = $state(false)
  let settleFrom = $state("")
  let settleTo = $state("")
  let settleAmount = $state("")
  let settleCurrency = $state("CAD")
  let settleDate = $state(new Date().toISOString().slice(0, 10))
  let settleNote = $state("")
  let settleError = $state("")
  let settleSubmitting = $state(false)

  const memberTotalWeight = $derived(
    group?.members.reduce((s, m) => s + m.shareWeight, 0) ?? 0,
  )

  const allSettled = $derived(
    balances.length === 0 || balances.every((b) => b.transfers.length === 0),
  )

  function memberPct(shareWeight: number): number {
    return memberTotalWeight > 0
      ? Math.round((shareWeight / memberTotalWeight) * 100)
      : 0
  }

  function initials(name: string | null | undefined): string {
    return (
      (name ?? "")
        .split(" ")
        .map((w) => w[0] ?? "")
        .join("")
        .toUpperCase()
        .slice(0, 2) || "?"
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
      expenseCurrency = g.defaultCurrency ?? "CAD"
      settleCurrency = g.defaultCurrency ?? "CAD"
    } catch {
      notFound = true
    } finally {
      loading = false
    }
  })

  async function handleInvite() {
    if (!inviteEmail.trim() || inviteSubmitting) return
    inviteError = ""
    inviteSubmitting = true
    try {
      const invite = await sendInvite(groupId, inviteEmail.trim())
      invites = [...invites, invite]
      inviteEmail = ""
    } catch (e: any) {
      inviteError = e.message ?? "Failed to send invite"
    } finally {
      inviteSubmitting = false
    }
  }

  async function handleCancelInvite(inviteId: string) {
    await cancelInvite(groupId, inviteId)
    invites = invites.filter((i) => i.id !== inviteId)
  }

  function handleInviteKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") handleInvite()
  }

  async function handleAddExpense() {
    if (
      !expenseAmount ||
      parseFloat(expenseAmount) <= 0 ||
      expenseSubmitting
    )
      return
    expenseError = ""
    expenseSubmitting = true
    try {
      const expense = await createExpense(groupId, {
        description: expenseDesc.trim() || "Expense",
        amount: expenseAmount,
        currency: expenseCurrency.trim().toUpperCase(),
        date: expenseDate,
        paidByUserId: expensePaidBy || currentUserId,
      })
      expenses = [expense, ...expenses]
      expenseDesc = ""
      expenseAmount = ""
      added = true
      await refreshBalances()
      setTimeout(() => {
        added = false
      }, 1200)
    } catch (e: any) {
      expenseError = e.message ?? "Failed to add expense"
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
    showSettleForm = true
  }

  async function handleSettle() {
    if (!settleFrom || !settleTo || settleFrom === settleTo || !settleAmount || settleSubmitting) return
    settleError = ""
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
      settleAmount = ""
      settleNote = ""
      showSettleForm = false
      await refreshBalances()
    } catch (e: any) {
      settleError = e.message ?? "Failed to record settlement"
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

  function openConfig() {
    if (!group) return
    configCurrency = group.defaultCurrency ?? ""
    const total = group.members.reduce((s, m) => s + m.shareWeight, 0)
    const sliders: Record<string, number> = {}
    for (const m of group.members) {
      sliders[m.userId] =
        total > 0 ? (m.shareWeight / total) * 100 : 100 / group.members.length
    }
    shareSliders = sliders
    showConfig = !showConfig
  }

  async function saveDefaultCurrency(code: string) {
    if (!group) return
    group = await updateGroup(groupId, { defaultCurrency: code })
    expenseCurrency = code
  }

  function adjustSlider(userId: string, newPct: number) {
    if (!group) return
    const others = group.members
      .map((m) => m.userId)
      .filter((id) => id !== userId)
    const oldOtherSum = others.reduce(
      (s, id) => s + (shareSliders[id] ?? 0),
      0,
    )
    const remaining = 100 - newPct
    const updated = { ...shareSliders, [userId]: newPct }
    if (oldOtherSum === 0 || remaining <= 0) {
      const perOther = others.length > 0 ? remaining / others.length : 0
      for (const id of others) updated[id] = Math.max(0, perOther)
    } else {
      for (const id of others) {
        updated[id] = ((shareSliders[id] ?? 0) / oldOtherSum) * remaining
      }
    }
    shareSliders = updated
  }

  function resetWeights() {
    if (!group) return
    const pct = 100 / group.members.length
    const updated: Record<string, number> = {}
    for (const m of group.members) updated[m.userId] = pct
    shareSliders = updated
  }

  async function saveWeights() {
    if (!group || weightSaving) return
    weightSaving = true
    try {
      const rounded: Record<string, number> = {}
      for (const id of Object.keys(shareSliders)) {
        rounded[id] = Math.max(1, Math.round(shareSliders[id]))
      }
      await Promise.all(
        group.members
          .filter(
            (m) =>
              rounded[m.userId] !== undefined &&
              rounded[m.userId] !== m.shareWeight,
          )
          .map((m) => updateMemberWeight(groupId, m.userId, rounded[m.userId])),
      )
      group = {
        ...group,
        members: group.members.map((m) => ({
          ...m,
          shareWeight: rounded[m.userId] ?? m.shareWeight,
        })),
      }
      showConfig = false
    } finally {
      weightSaving = false
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
  {:else}
    <div class="left-col">
      <header class="page-header">
        <h1 class="page-title">{group.name}</h1>
        <Toggle bind:checked={showMembers} label="Show members" />
        <GradientButton
          square
          active={showConfig}
          onclick={openConfig}
          tooltip="Group settings"
        >
          <Icon name="settings" size={12} />
        </GradientButton>
      </header>

      {#if showConfig && group}
        <div class="config-panel">
          <div class="config-header">
            <span class="config-title">Group Settings</span>
          </div>
          <div class="config-body">
            {#if group.createdBy === currentUserId}
              <div class="setting-row">
                <span class="setting-label">Default currency</span>
                <div class="setting-control">
                  <CurrencyInput
                    bind:value={configCurrency}
                    style="width: 60px"
                    oncommit={saveDefaultCurrency}
                  />
                </div>
              </div>
            {/if}
            <div class="setting-row setting-row--column">
              <span class="setting-label">Share split</span>
              <div class="share-sliders">
                {#each group.members as member (member.id)}
                  <div class="slider-row">
                    <span class="slider-name">{member.userName}</span>
                    <input
                      type="range"
                      class="slider-track"
                      min="0"
                      max="100"
                      step="0.1"
                      value={shareSliders[member.userId] ?? 0}
                      oninput={(e) =>
                        adjustSlider(
                          member.userId,
                          parseFloat((e.target as HTMLInputElement).value),
                        )}
                    />
                    <span class="slider-pct"
                      >{Math.round(shareSliders[member.userId] ?? 0)}%</span
                    >
                  </div>
                {/each}
                <div class="slider-actions">
                  <GradientButton onclick={resetWeights}>Reset equal</GradientButton>
                  <GradientButton onclick={saveWeights} disabled={weightSaving}>Save</GradientButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}

      <div class="left-body">
        <!-- Members (toggleable) -->
        {#if showMembers}
          <div class="section-bar">
            <span class="section-bar-title">Members</span>
            <GradientButton
              onclick={() => {
                showInvite = !showInvite
                inviteEmail = ""
                inviteError = ""
              }}
            >
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
                <GradientButton
                  onclick={handleInvite}
                  disabled={inviteSubmitting || !inviteEmail.trim()}
                >Send invite</GradientButton>
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

          <!-- Amount + currency -->
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
            <div class="field field-currency">
              <span class="field-label">Currency</span>
              <CurrencyInput bind:value={expenseCurrency} style="width: 100%" />
            </div>
            <div class="field field-date">
              <span class="field-label">Date</span>
              <TextInput bind:value={expenseDate} type="date" class="fill-input" />
            </div>
          </div>

          <!-- Paid by chips -->
          <div class="field">
            <span class="field-label">Paid by</span>
            <div class="payer-chips">
              {#each group.members as m (m.id)}
                {@const pct = memberPct(m.shareWeight)}
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

          <!-- Split bar (2+ members) -->
          {#if group.members.length >= 2}
            {@const firstPct = memberPct(group.members[0].shareWeight)}
            <div class="split-bar-wrap">
              <div class="split-track">
                <div class="split-fill" style="width:{firstPct}%"></div>
              </div>
              <div class="split-labels">
                <span>{group.members[0].userName} {firstPct}%</span>
                <span>{group.members[1].userName} {100 - firstPct}%</span>
              </div>
            </div>
          {/if}

          <!-- Add button -->
          <div class="add-cta">
            <GradientButton
              active={added}
              onclick={handleAddExpense}
              disabled={expenseSubmitting ||
                !expenseAmount ||
                parseFloat(expenseAmount) <= 0}
            >
              {added ? "✓ Added" : "Add Expense"}
            </GradientButton>
          </div>

          {#if expenseError}
            <span class="form-error">{expenseError}</span>
          {/if}
        </div>

        <!-- Balances -->
        <div class="section-bar">
          <span class="section-bar-title">Balances</span>
          <GradientButton
            onclick={() => {
              showSettleForm = !showSettleForm
              settleError = ""
            }}
          >
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
              <TextInput
                bind:value={settleAmount}
                placeholder="0.00"
                type="number"
                min="0"
                step="0.01"
                class="settle-amount"
              />
              <CurrencyInput bind:value={settleCurrency} style="width: 60px" />
              <TextInput bind:value={settleDate} type="date" class="settle-date" />
              <TextInput
                bind:value={settleNote}
                placeholder="Note (optional)"
                class="settle-note"
              />
              <GradientButton
                onclick={handleSettle}
                disabled={settleSubmitting || !settleFrom || !settleTo || !settleAmount}
              >Save</GradientButton>
            </div>
            {#if settleError}
              <span class="form-error">{settleError}</span>
            {/if}
          </div>
        {/if}

        {#if allSettled}
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
                  <span class="transfer-amount"
                    >{t.currency} {parseFloat(t.amount).toFixed(2)}</span
                  >
                  <GradientButton
                    onclick={() =>
                      prefillSettle(t.fromUserId, t.toUserId, t.amount, t.currency)}
                  >Settle up</GradientButton>
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
            class:active={panelTab === "expenses"}
            onclick={() => (panelTab = "expenses")}
          >
            Expenses{#if expenses.length > 0}
              <span class="tab-count"> {expenses.length}</span>{/if}
          </button>
          <button
            class="panel-tab"
            class:active={panelTab === "settlements"}
            onclick={() => (panelTab = "settlements")}
          >
            Settlements{#if settlements.length > 0}
              <span class="tab-count"> {settlements.length}</span>{/if}
          </button>
        </div>

        <div class="panel-body">
          {#if panelTab === "expenses"}
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
                          e.key === "Enter" &&
                          (expandedExpenseId =
                            expandedExpenseId === expense.id
                              ? null
                              : expense.id)}
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
                            ? "chevron-up"
                            : "chevron-down"}
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
                            <span class="split-amount"
                              >{expense.currency}
                              {parseFloat(split.amount).toFixed(2)}</span
                            >
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
                  <span class="settlement-amount"
                    >{s.currency} {parseFloat(s.amount).toFixed(2)}</span
                  >
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
    gap: var(--sp-md);
    padding: 8px 22px;
    border-bottom: 1px solid var(--color-rule-soft);
    font-size: var(--text-sm);
  }

  .member-row:last-child {
    border-bottom: none;
  }

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

  /* Amount row: amount + currency + date side by side */
  .amount-row {
    display: flex;
    gap: var(--sp-sm);
    align-items: flex-end;
  }

  .field-amount {
    flex: 1;
    min-width: 0;
  }

  .field-currency {
    width: 64px;
    flex-shrink: 0;
  }

  .field-date {
    width: 138px;
    flex-shrink: 0;
  }

  /* Make amount input slightly more prominent */
  .expense-form-wrap :global(.amount-text) {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-variant-numeric: tabular-nums;
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
    background: linear-gradient(180deg, var(--color-btn-gradient-hi), var(--color-rule-soft));
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
    background: linear-gradient(180deg, var(--color-btn-gradient-hi), var(--color-accent-chip-bg));
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
     Split bar
     ==================================================================== */
  .split-bar-wrap {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .split-track {
    height: 5px;
    background: var(--color-accent-bar-track);
    box-shadow: var(--shadow-sunken);
    overflow: hidden;
  }

  .split-fill {
    height: 100%;
    background: var(--color-accent);
    transition: width 200ms var(--ease);
  }

  .split-labels {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--color-text-muted);
  }

  /* ====================================================================
     Add Expense button — full-width GradientButton override
     ==================================================================== */
  .add-cta :global(.btn) {
    width: 100%;
    height: 28px;
    font-size: var(--text-sm);
  }

  .form-error {
    font-size: var(--text-xs);
    color: var(--color-amount-negative);
    font-family: var(--font-sans);
    display: block;
  }

  /* ====================================================================
     Balances
     ==================================================================== */
  .balances-body {
    background: var(--color-window);
  }

  .transfer-row {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: 8px 22px;
    border-bottom: 1px solid var(--color-rule-soft);
    font-size: var(--text-sm);
  }

  .transfer-row:last-child {
    border-bottom: none;
  }

  .transfer-names {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
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

  .transfer-amount {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--color-amount-negative);
  }

  /* ====================================================================
     Settle form
     ==================================================================== */
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

  .settle-form :global(.settle-amount) {
    width: 80px;
  }

  .settle-form :global(.settle-date) {
    width: 120px;
  }

  .settle-form :global(.settle-note) {
    flex: 1;
    min-width: 120px;
  }

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

  .empty {
    padding: var(--sp-lg) 22px;
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-muted);
  }

  /* ====================================================================
     Config panel
     ==================================================================== */
  .config-panel {
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-rule);
  }

  .config-header {
    padding: 3px 14px;
    background: var(--color-window-raised);
    border-bottom: 1px solid var(--color-rule);
  }

  .config-title {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .config-body {
    background: var(--color-window);
    padding: var(--sp-sm) 14px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
  }

  .setting-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .setting-row--column {
    flex-direction: column;
    align-items: flex-start;
  }

  .setting-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .share-sliders {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .slider-name {
    width: 120px;
    font-size: var(--text-sm);
    color: var(--color-text);
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slider-track {
    flex: 1;
    cursor: pointer;
    accent-color: var(--color-accent);
  }

  .slider-pct {
    width: 32px;
    text-align: right;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .slider-actions {
    display: flex;
    gap: var(--sp-xs);
    justify-content: flex-end;
    margin-top: var(--sp-xs);
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

  /* Initials avatar in right panel */
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
    font-variant-numeric: tabular-nums;
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
    font-variant-numeric: tabular-nums;
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
    font-variant-numeric: tabular-nums;
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

    .field-date {
      flex: 1;
      min-width: 120px;
    }

    .paid-by-select {
      height: 32px;
    }

    .member-row,
    .invite-form,
    .pending-row,
    .transfer-row,
    .settle-form-wrap {
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
