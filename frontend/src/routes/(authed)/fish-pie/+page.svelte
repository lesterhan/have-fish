<script lang="ts">
  import { onMount } from 'svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import {
    fetchGroups,
    createGroup,
    fetchMyInvites,
    acceptInvite,
    declineInvite,
  } from '$lib/api'
  import type { ExpenseGroup, GroupInvite } from '$lib/api'

  let groups = $state<ExpenseGroup[]>([])
  let invites = $state<GroupInvite[]>([])
  let loading = $state(true)
  let showForm = $state(false)
  let newName = $state('')
  let submitting = $state(false)

  onMount(async () => {
    try {
      const [g, inv] = await Promise.all([fetchGroups(), fetchMyInvites()])
      groups = g
      invites = inv
    } finally {
      loading = false
    }
  })

  async function handleCreate() {
    if (!newName.trim() || submitting) return
    submitting = true
    try {
      const group = await createGroup(newName.trim())
      groups = [group, ...groups]
      newName = ''
      showForm = false
    } finally {
      submitting = false
    }
  }

  async function handleAccept(invite: GroupInvite) {
    await acceptInvite(invite.id)
    invites = invites.filter((i) => i.id !== invite.id)
    const updated = await fetchGroups()
    groups = updated
  }

  async function handleDecline(inviteId: string) {
    await declineInvite(inviteId)
    invites = invites.filter((i) => i.id !== inviteId)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleCreate()
    if (e.key === 'Escape') {
      showForm = false
      newName = ''
    }
  }
</script>

<div class="page">
  <header class="page-header">
    <h1 class="page-title">Fish Pie Expense Splitting</h1>
    <GradientButton
      onclick={() => {
        showForm = !showForm
        newName = ''
      }}
    >
      <Icon name="plus" size={12} /> New group
    </GradientButton>
  </header>

  {#if showForm}
    <div class="new-group-form">
      <TextInput
        bind:value={newName}
        placeholder="Group name"
        onkeydown={handleKeydown}
        autofocus
      />
      <GradientButton
        onclick={handleCreate}
        disabled={submitting || !newName.trim()}
      >
        Create
      </GradientButton>
      <GradientButton
        onclick={() => {
          showForm = false
          newName = ''
        }}
      >
        Cancel
      </GradientButton>
    </div>
  {/if}

  {#if !loading && invites.length > 0}
    <div class="section-bar">
      <span class="section-bar-title">Pending invites</span>
    </div>
    <div class="invites-body">
      {#each invites as invite (invite.id)}
        <div class="invite-row">
          <div class="invite-info">
            <span class="invite-group">{invite.groupName}</span>
            <span class="invite-from">invited by {invite.inviterName}</span>
          </div>
          <div class="invite-actions">
            <GradientButton onclick={() => handleAccept(invite)}
              >Accept</GradientButton
            >
            <GradientButton
              onclick={() => handleDecline(invite.id)}
              variant="warning">Decline</GradientButton
            >
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <div class="section-bar"><span class="section-bar-title">Groups</span></div>

  <div class="body">
    {#if loading}
      <p class="empty">Loading…</p>
    {:else if groups.length === 0}
      <p class="empty">
        No groups yet. Create one to start splitting expenses with others.
      </p>
    {:else}
      {#each groups as group (group.id)}
        <a class="group-row" href="/fish-pie/{group.id}">
          <span class="group-name">{group.name}</span>
          <span class="group-meta"
            >{group.members.length} member{group.members.length === 1
              ? ''
              : 's'}</span
          >
          <Icon name="chevron-right-filled" size={12} />
        </a>
      {/each}
    {/if}
  </div>
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
    justify-content: space-between;
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
  }

  .new-group-form {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-xs) 22px;
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule);
    flex-shrink: 0;
  }

  .new-group-form :global(.text-input) {
    flex: 1;
    max-width: 280px;
  }

  .section-bar {
    display: flex;
    align-items: center;
    padding: 6px 14px;
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

  .invites-body {
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule);
    flex-shrink: 0;
  }

  .invite-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-md);
    padding: 8px 22px;
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .invite-row:last-child {
    border-bottom: none;
  }

  .invite-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .invite-group {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .invite-from {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .invite-actions {
    display: flex;
    gap: var(--sp-xs);
    flex-shrink: 0;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: var(--color-window-raised);
  }

  .group-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 10px 22px;
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule-soft);
    text-decoration: none;
    font-family: var(--font-sans);
    transition: background var(--duration-fast) var(--ease);
  }

  .group-row:hover {
    background: var(--color-window-raised);
  }

  .group-name {
    flex: 1;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .group-meta {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .empty {
    padding: var(--sp-lg) 22px;
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-muted);
  }
</style>
