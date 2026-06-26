<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import {
    fetchGroupOverview,
    sendInvite,
    cancelInvite,
    createExpense,
    deleteExpense,
    updateExpense,
    fetchBalances,
    fetchSettlements,
    createSettlementBatch,
    confirmSettlement,
    confirmSettlementBatch,
    deleteSettlement,
    updateGroup,
    updateMemberWeight,
    deleteGroup,
    fetchAccounts,
    fetchUserSettings,
  } from '$lib/api'
  import { owedDebts } from '$lib/fish-pie-settle'
  import Shimmer from '$lib/components/ui/Shimmer.svelte'
  import type {
    ExpenseGroup,
    GroupInvite,
    GroupExpense,
    CurrencyBalance,
    GroupSettlement,
    Account,
  } from '$lib/api'
  import { useSession } from '$lib/auth'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import CurrencyInput from '$lib/components/ui/CurrencyInput.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import Toggle from '$lib/components/ui/Toggle.svelte'
  import GroupBalancePanel from '$lib/components/fish-pie/GroupBalancePanel.svelte'
  import GroupExpenseForm from '$lib/components/fish-pie/GroupExpenseForm.svelte'
  import GroupRightPanel from '$lib/components/fish-pie/GroupRightPanel.svelte'
  import GroupSettleBatchModal from '$lib/components/fish-pie/GroupSettleBatchModal.svelte'

  const groupId = $derived(page.params.id ?? '')
  const session = useSession()
  const currentUserId = $derived($session.data?.user.id ?? '')

  let group = $state<ExpenseGroup | null>(null)
  let invites = $state<GroupInvite[]>([])
  let expenses = $state<GroupExpense[]>([])
  let balances = $state<CurrencyBalance[]>([])
  let settlements = $state<GroupSettlement[]>([])
  let allAccounts = $state<Account[]>([])
  let loading = $state(true)
  let notFound = $state(false)

  let showMembers = $state(false)
  let configCurrency = $state('')

  let inviteEmail = $state('')
  let inviteError = $state('')
  let inviteSubmitting = $state(false)

  let showSettleModal = $state(false)
  // Home currency the batch modal defaults its "settle in" selector to.
  let preferredCurrency = $state('CAD')

  let initialSliderPct = $state(50)
  let confirmDelete = $state(false)
  let deleting = $state(false)

  const allSettled = $derived(
    balances.length === 0 || balances.every((b) => b.transfers.length === 0),
  )

  // Debts the current user owes, across all currencies — fed to the settle modal.
  const myDebts = $derived(owedDebts(balances, currentUserId))

  const myExpenseAccountPath = $derived.by(() => {
    if (!group) return null
    const myMember = group.members.find((m) => m.userId === currentUserId)
    if (!myMember?.defaultExpenseAccountId) return null
    return allAccounts.find((a) => a.id === myMember.defaultExpenseAccountId)?.path ?? null
  })

  const myPaymentAccountPath = $derived.by(() => {
    if (!group) return null
    const myMember = group.members.find((m) => m.userId === currentUserId)
    if (!myMember?.defaultPaymentAccountId) return null
    return allAccounts.find((a) => a.id === myMember.defaultPaymentAccountId)?.path ?? null
  })

  onMount(async () => {
    try {
      // One round-trip for the group bundle; accounts + settings in parallel.
      const [overview, accts, settings] = await Promise.all([
        fetchGroupOverview(groupId),
        fetchAccounts(),
        fetchUserSettings(),
      ])
      const g = overview.group
      group = g
      invites = overview.invites
      expenses = overview.expenses
      balances = overview.balances
      settlements = overview.settlements
      allAccounts = accts
      preferredCurrency = settings.preferredCurrency ?? g.defaultCurrency ?? 'CAD'
      configCurrency = g.defaultCurrency ?? ''
      if (g.members.length === 2) {
        const total = g.members[0].shareWeight + g.members[1].shareWeight
        initialSliderPct =
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

  async function handleAddExpense(data: {
    description: string
    amount: string
    currency: string
    date: string
    paidByUserId: string
    paymentAccountId: string
    categoryId: string | null
  }): Promise<GroupExpense> {
    const expense = await createExpense(groupId, data)
    expenses = [expense, ...expenses]
    await refreshBalances()
    return expense
  }

  async function handleDeleteExpense(expenseId: string) {
    await deleteExpense(groupId, expenseId)
    expenses = expenses.filter((e) => e.id !== expenseId)
    await refreshBalances()
  }

  async function handleUpdateExpense(
    expenseId: string,
    data: Parameters<typeof updateExpense>[2],
  ) {
    const updated = await updateExpense(groupId, expenseId, data)
    expenses = expenses.map((e) => (e.id === expenseId ? updated : e))
    await refreshBalances()
    return updated
  }

  async function handleSettle(data: Parameters<typeof createSettlementBatch>[1]) {
    await createSettlementBatch(groupId, data)
    await refreshBalances()
  }

  async function handleDeleteSettlement(settlementId: string) {
    await deleteSettlement(groupId, settlementId)
    await refreshBalances()
  }

  async function handleConfirmSettlement(settlementId: string, receiverAccountId: string) {
    // Batch rows confirm through the batch endpoint (the single-row path rejects them,
    // since a cross-currency row's cash leg is in the settled, not the debt, currency).
    const s = settlements.find((x) => x.id === settlementId)
    if (s?.batchId) await confirmSettlementBatch(groupId, s.batchId, receiverAccountId)
    else await confirmSettlement(groupId, settlementId, receiverAccountId)
    await refreshBalances()
  }

  async function refreshBalances() {
    const [bal, sett] = await Promise.all([
      fetchBalances(groupId),
      fetchSettlements(groupId),
    ])
    balances = bal
    settlements = sett
  }

  async function saveDefaultCurrency(code: string) {
    if (!group) return
    group = await updateGroup(groupId, { defaultCurrency: code })
  }

  async function saveShareSlider(pct: number) {
    if (!group) return
    const w0 = Math.max(1, Math.round(pct))
    const w1 = Math.max(1, 100 - w0)
    await Promise.all([
      updateMemberWeight(groupId, group.members[0].userId, w0),
      updateMemberWeight(groupId, group.members[1].userId, w1),
    ])
  }

  async function handleDeleteGroup() {
    if (deleting) return
    deleting = true
    try {
      await deleteGroup(groupId)
      goto('/fish-pie')
    } catch {
      deleting = false
    }
  }

</script>

<div class="page">
  {#if loading}
    <div class="left-col">
      <header class="page-header">
        <a href="/fish-pie">
          <GradientButton square>
            <Icon name="back" />
          </GradientButton>
        </a>
        <div class="skel-title"><Shimmer width="190px" height="24px" /></div>
      </header>
      <div class="left-body">
        <div class="skel-bar"></div>
        <div class="skel-form">
          {#each Array.from({ length: 4 }) as _, i (i)}
            <div class="skel-field">
              <Shimmer width="90px" height="9px" />
              <Shimmer width="100%" height="26px" />
            </div>
          {/each}
          <Shimmer width="100%" height="36px" />
        </div>
      </div>
    </div>
    <div class="right-col">
      <div class="skel-bar"></div>
      <div class="skel-rows">
        {#each Array.from({ length: 6 }) as _, i (i)}
          <div class="skel-row">
            <Shimmer width="24px" height="24px" />
            <div class="skel-row-text">
              <Shimmer width="55%" height="13px" />
              <Shimmer width="35%" height="10px" />
            </div>
            <Shimmer width="60px" height="13px" />
          </div>
        {/each}
      </div>
    </div>
  {:else if notFound || !group}
    <div class="left-col">
      <header class="page-header">
        <h1 class="page-title">Group not found</h1>
      </header>
    </div>
    <div class="right-col"></div>
  {:else if group.members.length === 1}
    <div class="left-col">
      <header class="page-header">
        <a href="/fish-pie">
          <GradientButton square>
            <Icon name="back" />
          </GradientButton>
        </a>
        <h1 class="page-title">{group.name}</h1>
        {#if group.createdBy === currentUserId}
          <GradientButton
            square
            active={confirmDelete}
            onclick={() => (confirmDelete = !confirmDelete)}
          >
            <Icon name="trash" size={12} />
          </GradientButton>
        {/if}
      </header>
      {#if confirmDelete}
        <div class="confirm-bar">
          <span class="confirm-text">Delete <strong>{group.name}</strong>?</span>
          <GradientButton variant="warning" onclick={handleDeleteGroup} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </GradientButton>
          <GradientButton onclick={() => (confirmDelete = false)} disabled={deleting}>Cancel</GradientButton>
        </div>
      {/if}
      <div class="left-body">
        <div class="section-bar">
          <span class="section-bar-title">Invite</span>
        </div>
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
                  <GradientButton onclick={() => handleCancelInvite(invite.id)}>
                    <Icon name="x" size={10} /> Cancel
                  </GradientButton>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
    <div class="right-col"></div>
  {:else if group.members.length === 2}
    <div class="left-col">
      <header class="page-header">
        <a href="/fish-pie">
          <GradientButton square>
            <Icon name="back" />
          </GradientButton>
        </a>
        <h1 class="page-title">{group.name}</h1>
        <div class="header-controls">
          <CurrencyInput
            bind:value={configCurrency}
            style="width: 40px"
            oncommit={saveDefaultCurrency}
          />
          <Toggle bind:checked={showMembers} label="Balances" />
          <a href="/fish-pie/{groupId}/settings">
            <GradientButton square>
              <Icon name="settings" size={12} />
            </GradientButton>
          </a>
        </div>
      </header>

      <div class="left-body">
        {#if showMembers}
          <GroupBalancePanel
            members={group.members}
            {balances}
            {allSettled}
            {currentUserId}
            onSettleClick={() => (showSettleModal = true)}
          />
        {/if}

        <GroupExpenseForm
          members={group.members}
          {currentUserId}
          defaultCurrency={group.defaultCurrency ?? 'CAD'}
          {initialSliderPct}
          {groupId}
          {myExpenseAccountPath}
          {myPaymentAccountPath}
          {allAccounts}
          categories={group.categories}
          onCreate={handleAddExpense}
          onSliderChange={saveShareSlider}
        />
      </div>
    </div>

    <div class="right-col">
      <GroupRightPanel
        {expenses}
        {settlements}
        members={group.members}
        {currentUserId}
        {groupId}
        {allAccounts}
        categories={group.categories}
        groupCreatedBy={group.createdBy}
        onDeleteExpense={handleDeleteExpense}
        onDeleteSettlement={handleDeleteSettlement}
        onUpdateExpense={handleUpdateExpense}
        onConfirmSettlement={handleConfirmSettlement}
      />
    </div>
  {/if}
</div>

<GroupSettleBatchModal
  bind:open={showSettleModal}
  debts={myDebts}
  defaultTargetCurrency={preferredCurrency}
  payerAccounts={allAccounts}
  onSettle={handleSettle}
/>

<style>
  .page {
    display: grid;
    grid-template-columns: 1fr 420px;
    height: 100%;
    overflow: hidden;
  }

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

  /* ── Loading skeleton ── */
  .skel-title {
    flex: 1;
    display: flex;
    align-items: center;
  }

  .skel-bar {
    height: 22px;
    background: var(--color-section-bar-bg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
    flex-shrink: 0;
  }

  .skel-form {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    padding: 12px 22px;
    background: var(--color-window);
  }

  .skel-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .skel-rows {
    background: var(--color-window);
  }

  .skel-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .skel-row-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .confirm-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) 22px;
    background: var(--color-danger-light);
    border-bottom: 1px solid var(--color-danger);
    flex-shrink: 0;
  }

  .confirm-text {
    flex: 1;
    font-size: var(--text-sm);
    color: var(--color-danger);
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

  .form-error {
    font-size: var(--text-xs);
    color: var(--color-amount-negative);
    font-family: var(--font-sans);
    display: block;
  }

  .right-col {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

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

    .page-header {
      padding: 10px 14px 8px;
      flex-wrap: wrap;
    }

    .invite-form,
    .pending-row {
      padding-left: 14px;
      padding-right: 14px;
    }
  }
</style>
