<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { fetchGroup, fetchAccounts, deleteGroup, updateMyExpenseAccount, updateGroup } from '$lib/api'
  import type { ExpenseGroup, Account } from '$lib/api'
  import { useSession } from '$lib/auth'
  import { toast } from '$lib/toast.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'
  import CategoryManager from '$lib/components/fish-pie/CategoryManager.svelte'

  const groupId = $derived(page.params.id ?? '')
  const session = useSession()
  const currentUserId = $derived($session.data?.user.id ?? '')

  let group = $state<ExpenseGroup | null>(null)
  let allAccounts = $state<Account[]>([])
  let myExpenseAccountId = $state('')
  let savingExpenseAccount = $state(false)
  let groupName = $state('')
  let savingGroupName = $state(false)
  let loading = $state(true)
  let notFound = $state(false)
  let confirmDelete = $state(false)
  let deleting = $state(false)

  onMount(async () => {
    try {
      const [g, accts] = await Promise.all([fetchGroup(groupId), fetchAccounts()])
      group = g
      allAccounts = accts
      groupName = g.name
      const myMember = g.members.find((m) => m.userId === currentUserId)
      myExpenseAccountId = myMember?.defaultExpenseAccountId ?? ''
    } catch {
      notFound = true
    } finally {
      loading = false
    }
  })

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

  async function handleGroupNameSave() {
    const trimmed = groupName.trim()
    if (!trimmed || savingGroupName || trimmed === group?.name) return
    savingGroupName = true
    try {
      const updated = await updateGroup(groupId, { name: trimmed })
      group = updated
      groupName = updated.name
      toast.show('Group name updated')
    } finally {
      savingGroupName = false
    }
  }

  // A new account created from any AccountPathInput on this page must be folded
  // into the local list — otherwise the input can't match it back on blur and
  // reverts to blank even though the value was saved.
  function handleAccountCreated(account: Account) {
    allAccounts = [...allAccounts, account]
  }

  async function handleExpenseAccountCommit(accountId: string) {
    if (savingExpenseAccount) return
    savingExpenseAccount = true
    try {
      const updated = await updateMyExpenseAccount(groupId, accountId || null)
      myExpenseAccountId = updated.defaultExpenseAccountId ?? ''
      toast.show('Expense account updated')
    } finally {
      savingExpenseAccount = false
    }
  }

  const isCreator = $derived(group !== null && group.createdBy === currentUserId)
</script>

<div class="page">
  <header class="page-header">
    <a href="/fish-pie/{groupId}">
      <GradientButton square>
        <Icon name="back" />
      </GradientButton>
    </a>
    <h1 class="page-title">
      {group ? `${group.name} — Settings` : 'Group Settings'}
    </h1>
  </header>

  {#if loading}
    <div class="body"></div>
  {:else if notFound || !group}
    <div class="body">
      <p class="empty">Group not found.</p>
    </div>
  {:else}
    <div class="body">
      <div class="body-inner">
        <div class="section-bar">
          <span class="section-bar-title">Group</span>
        </div>
        {#if isCreator}
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Name</span>
              <span class="setting-hint">Shown to everyone in this group.</span>
            </div>
            <div class="setting-input setting-input--name">
              <TextInput
                bind:value={groupName}
                onkeydown={(e) => e.key === 'Enter' && handleGroupNameSave()}
                onblur={handleGroupNameSave}
                disabled={savingGroupName}
                style="width: 100%"
              />
            </div>
          </div>
        {/if}
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">My default account</span>
            <span class="setting-hint">Where my share posts when an expense has no category. Categories below can override it.</span>
          </div>
          <div class="setting-input">
            <AccountPathInput
              accounts={allAccounts}
              bind:value={myExpenseAccountId}
              placeholder="Uncategorized (default)"
              allowCreate={true}
              oncreate={handleAccountCreated}
              oncommit={handleExpenseAccountCommit}
            />
          </div>
        </div>

        <div class="section-bar">
          <span class="section-bar-title">Categories</span>
        </div>
        <p class="section-intro">
          Tag each expense with a category. Per category, you can set your own account and a custom split — both fall back to the group defaults above.
        </p>
        <CategoryManager
          {groupId}
          members={group.members}
          {currentUserId}
          accounts={allAccounts}
          categories={group.categories}
          onAccountCreated={handleAccountCreated}
        />

        {#if isCreator}
          <div class="danger-footer">
          {#if !confirmDelete}
            <button class="danger-link" onclick={() => (confirmDelete = true)}>Delete group…</button>
            <span class="danger-desc">Removes this group for all members. This cannot be undone.</span>
          {:else}
            <div class="confirm-actions">
              <span class="confirm-text">Are you sure?</span>
              <GradientButton variant="warning" active onclick={handleDeleteGroup} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </GradientButton>
              <GradientButton onclick={() => (confirmDelete = false)} disabled={deleting}>Cancel</GradientButton>
            </div>
          {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
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

  .section-bar {
    display: flex;
    align-items: center;
    padding: 4px 14px;
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
    flex-shrink: 0;
  }

  .section-bar-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: var(--color-window-raised);
    display: flex;
    flex-direction: column;
  }

  .body-inner {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .section-intro {
    margin: 0;
    padding: var(--sp-sm) 22px;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule-soft);
    line-height: var(--leading-normal);
  }

  .setting-row {
    display: flex;
    align-items: center;
    gap: var(--sp-xl);
    padding: var(--sp-md) 22px;
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 300px;
    flex-shrink: 0;
  }

  .setting-label {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .setting-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-normal);
  }

  .setting-input {
    flex: 1;
    max-width: 360px;
  }

  .setting-input--name {
    max-width: 280px;
  }

  .danger-footer {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: var(--sp-md) 22px var(--sp-lg);
    border-top: 1px solid var(--color-rule-soft);
    /* Push to the very bottom of the scroll body so the delete action sits far
       from the regularly-used controls and can't be clicked by accident. */
    margin-top: auto;
    padding-top: var(--sp-lg);
  }

  .danger-link {
    background: none;
    border: none;
    padding: 0;
    font-size: var(--text-xs);
    color: var(--color-danger);
    cursor: pointer;
    transition: opacity var(--duration-fast) var(--ease);
  }

  .danger-link:hover {
    text-decoration: underline;
  }

  .danger-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .confirm-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
  }

  .confirm-text {
    font-size: var(--text-xs);
    color: var(--color-danger);
    font-family: var(--font-mono);
    margin-right: var(--sp-xs);
  }

  .empty {
    padding: var(--sp-lg) 22px;
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-muted);
  }
</style>
