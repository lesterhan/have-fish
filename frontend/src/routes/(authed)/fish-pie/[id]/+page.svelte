<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { fetchGroup } from '$lib/api'
  import type { ExpenseGroup } from '$lib/api'

  const groupId = $derived(page.params.id ?? '')

  let group = $state<ExpenseGroup | null>(null)
  let loading = $state(true)
  let notFound = $state(false)

  onMount(async () => {
    try {
      group = await fetchGroup(groupId)
    } catch {
      notFound = true
    } finally {
      loading = false
    }
  })
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

    <div class="section-bar"><span class="section-bar-title">Members</span></div>
    <div class="members-body">
      {#each group.members as member (member.id)}
        <div class="member-row">
          <span class="member-name">{member.userName}</span>
          <span class="member-email">{member.userEmail}</span>
          <span class="member-weight">{member.shareWeight}</span>
        </div>
      {/each}
    </div>

    <div class="section-bar"><span class="section-bar-title">Expenses</span></div>
    <div class="body">
      <p class="empty">No expenses yet.</p>
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

  .members-body {
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule);
    flex-shrink: 0;
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

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: var(--color-window-raised);
  }

  .empty {
    padding: var(--sp-lg) 22px;
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-muted);
  }
</style>
