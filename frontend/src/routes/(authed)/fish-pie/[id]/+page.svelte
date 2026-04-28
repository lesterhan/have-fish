<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { fetchGroup, fetchGroupInvites, sendInvite, cancelInvite } from '$lib/api'
  import type { ExpenseGroup, GroupInvite } from '$lib/api'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'

  const groupId = $derived(page.params.id ?? '')

  let group = $state<ExpenseGroup | null>(null)
  let invites = $state<GroupInvite[]>([])
  let loading = $state(true)
  let notFound = $state(false)

  let showInvite = $state(false)
  let inviteEmail = $state('')
  let inviteError = $state('')
  let inviteSubmitting = $state(false)

  onMount(async () => {
    try {
      const [g, inv] = await Promise.all([fetchGroup(groupId), fetchGroupInvites(groupId)])
      group = g
      invites = inv
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

  async function handleCancel(inviteId: string) {
    await cancelInvite(groupId, inviteId)
    invites = invites.filter((i) => i.id !== inviteId)
  }

  function handleInviteKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleInvite()
  }
</script>

<div class="page">
  {#if loading}
    <header class="page-header">
      <div class="header-placeholder"></div>
    </header>
  {:else if notFound || !group}
    <header class="page-header">
      <h1 class="page-title">Group not found</h1>
    </header>
  {:else}
    <header class="page-header">
      <h1 class="page-title">{group.name}</h1>
      <span class="member-count">{group.members.length} member{group.members.length === 1 ? '' : 's'}</span>
    </header>

    <div class="body">
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
            <span class="invite-error">{inviteError}</span>
          {/if}
        </div>

        {#if invites.length > 0}
          <div class="pending-list">
            {#each invites as invite (invite.id)}
              <div class="pending-row">
                <span class="pending-email">{invite.inviteeEmail}</span>
                <span class="pending-label">Pending</span>
                <GradientButton onclick={() => handleCancel(invite.id)} variant="warning">
                  <Icon name="x" size={10} /> Cancel
                </GradientButton>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      {/if}

      <div class="section-bar"><span class="section-bar-title">Expenses</span></div>
      <div class="expenses-body">
        <p class="empty">No expenses yet.</p>
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
    align-items: baseline;
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
  }

  .member-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text-muted);
    letter-spacing: 0.04em;
  }

  .body {
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

  .invite-error {
    font-size: var(--text-xs);
    color: var(--color-amount-negative);
    font-family: var(--font-sans);
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

  .expenses-body {
    background: var(--color-window);
  }

  .empty {
    padding: var(--sp-lg) 22px;
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-muted);
  }
</style>
