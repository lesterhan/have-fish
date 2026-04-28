<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import HeadingBanner from '$lib/components/ui/HeadingBanner.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import { fetchGroups, createGroup } from '$lib/api'
  import type { ExpenseGroup } from '$lib/api'

  let groups = $state<ExpenseGroup[]>([])
  let loading = $state(true)
  let showForm = $state(false)
  let newName = $state('')
  let submitting = $state(false)

  onMount(async () => {
    groups = await fetchGroups()
    loading = false
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleCreate()
    if (e.key === 'Escape') { showForm = false; newName = '' }
  }
</script>

<div class="page">
  <HeadingBanner>
    <h1>Fish Pie</h1>
    <GradientButton onclick={() => { showForm = !showForm; newName = '' }}>
      <Icon name="plus" size={12} /> New group
    </GradientButton>
  </HeadingBanner>

  {#if showForm}
    <div class="new-group-form">
      <TextInput
        bind:value={newName}
        placeholder="Group name"
        onkeydown={handleKeydown}
        autofocus
      />
      <GradientButton onclick={handleCreate} disabled={submitting || !newName.trim()}>
        Create
      </GradientButton>
      <GradientButton onclick={() => { showForm = false; newName = '' }}>
        Cancel
      </GradientButton>
    </div>
  {/if}

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if groups.length === 0}
    <div class="empty">
      No groups yet. Create one to start splitting expenses with others.
    </div>
  {:else}
    <div class="group-list">
      {#each groups as group (group.id)}
        <button class="group-card" onclick={() => goto(`/fish-pie/${group.id}`)}>
          <span class="group-name">{group.name}</span>
          <span class="group-meta">{group.members.length} member{group.members.length === 1 ? '' : 's'}</span>
          <Icon name="chevron-right" size={12} />
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page {
    padding: var(--sp-lg);
    max-width: 640px;
  }

  .new-group-form {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-sm) var(--sp-md);
    background: var(--color-window-raised);
    border: 1px solid var(--color-rule);
    box-shadow: var(--shadow-raised);
    margin-bottom: var(--sp-md);
  }

  .new-group-form :global(.text-input) {
    flex: 1;
  }

  .group-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-rule);
    box-shadow: var(--shadow-raised);
  }

  .group-card {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-md);
    background: var(--color-window);
    border: none;
    border-bottom: 1px solid var(--color-rule-soft);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-sans);
    transition: background var(--duration-fast) var(--ease);
  }

  .group-card:last-child {
    border-bottom: none;
  }

  .group-card:hover {
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
    padding: var(--sp-lg);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    text-align: center;
    border: 1px solid var(--color-rule);
    box-shadow: var(--shadow-raised);
    background: var(--color-window);
  }
</style>
