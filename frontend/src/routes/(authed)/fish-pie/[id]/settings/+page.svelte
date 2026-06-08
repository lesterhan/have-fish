<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { fetchGroup, fetchAccounts, deleteGroup, updateMyExpenseAccount } from '$lib/api'
  import type { ExpenseGroup, Account } from '$lib/api'
  import { useSession } from '$lib/auth'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Button from '$lib/components/ui/Button.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'

  const groupId = $derived(page.params.id ?? '')
  const session = useSession()
  const currentUserId = $derived($session.data?.user.id ?? '')

  let group = $state<ExpenseGroup | null>(null)
  let allAccounts = $state<Account[]>([])
  let myExpenseAccountId = $state('')
  let savingExpenseAccount = $state(false)
  let loading = $state(true)
  let notFound = $state(false)
  let confirmDelete = $state(false)
  let deleting = $state(false)

  onMount(async () => {
    try {
      const [g, accts] = await Promise.all([fetchGroup(groupId), fetchAccounts()])
      group = g
      allAccounts = accts
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

  async function handleExpenseAccountCommit(accountId: string) {
    if (savingExpenseAccount) return
    savingExpenseAccount = true
    try {
      const updated = await updateMyExpenseAccount(groupId, accountId || null)
      myExpenseAccountId = updated.defaultExpenseAccountId ?? ''
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
      {#if group}{group.name} — {:else}Group {/if}Settings
    </h1>
  </header>

  {#if loading}
    <div class="body"></div>
  {:else if notFound || !group}
    <div class="body">
      <p class="empty">Group not found.</p>
    </div>
  {:else}
    <div class="section-bar">
      <span class="section-bar-title">My Settings</span>
    </div>
    <div class="body">
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">My expense account</span>
          <span class="setting-hint">Your share of group expenses posts here</span>
        </div>
        <div class="setting-input">
          <AccountPathInput
            accounts={allAccounts}
            bind:value={myExpenseAccountId}
            placeholder="Uncategorized (default)"
            allowCreate={false}
            oncommit={handleExpenseAccountCommit}
          />
        </div>
      </div>
    </div>

    {#if isCreator}
      <div class="section-bar">
        <span class="section-bar-title">Danger Zone</span>
      </div>
      <div class="body">
        <div class="danger-row">
          <div class="danger-info">
            <span class="danger-label">Delete group</span>
            <span class="danger-desc">Removes this group for all members. This cannot be undone.</span>
          </div>
          {#if !confirmDelete}
            <Button variant="danger" onclick={() => (confirmDelete = true)}>Delete group</Button>
          {:else}
            <div class="confirm-actions">
              <span class="confirm-text">Are you sure?</span>
              <Button variant="danger" onclick={handleDeleteGroup} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </Button>
              <Button onclick={() => (confirmDelete = false)} disabled={deleting}>Cancel</Button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
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
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-md);
    padding: var(--sp-md) 22px;
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
  }

  .setting-label {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .setting-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .setting-input {
    flex-shrink: 0;
    width: 220px;
  }

  .danger-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-md);
    padding: var(--sp-md) 22px;
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .danger-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .danger-label {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-danger);
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
