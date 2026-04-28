<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/stores'
  import { goto } from '$app/navigation'
  import HeadingBanner from '$lib/components/ui/HeadingBanner.svelte'
  import { fetchGroup } from '$lib/api'
  import type { ExpenseGroup } from '$lib/api'

  const groupId = $derived($page.params.id ?? '')

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

{#if loading}
  <div class="page"><span class="muted">Loading…</span></div>
{:else if notFound || !group}
  <div class="page"><span class="muted">Group not found.</span></div>
{:else}
  <div class="page">
    <HeadingBanner>
      <h1>{group.name}</h1>
    </HeadingBanner>

    <!-- Members section -->
    <section class="section">
      <div class="section-bar">Members</div>
      <div class="section-body">
        {#each group.members as member (member.id)}
          <div class="member-row">
            <span class="member-name">{member.userName}</span>
            <span class="member-email">{member.userEmail}</span>
            <span class="member-weight">weight {member.shareWeight}</span>
          </div>
        {/each}
      </div>
    </section>

    <!-- Expenses placeholder (Fish Pie — Expenses epic) -->
    <section class="section">
      <div class="section-bar">Expenses</div>
      <div class="section-body empty">Expense tracking coming in the next epic.</div>
    </section>
  </div>
{/if}

<style>
  .page {
    padding: var(--sp-lg);
    max-width: 640px;
  }

  .muted {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .section {
    margin-bottom: var(--sp-lg);
    border: 1px solid var(--color-rule);
    box-shadow: var(--shadow-raised);
  }

  .section-bar {
    padding: 3px var(--sp-sm);
    background: linear-gradient(to right, var(--color-panel-header-from), var(--color-panel-header-to));
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-panel-header-text);
  }

  .section-body {
    background: var(--color-window);
  }

  .section-body.empty {
    padding: var(--sp-md);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .member-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-md);
    border-bottom: 1px solid var(--color-rule-soft);
    font-size: var(--text-sm);
  }

  .member-row:last-child {
    border-bottom: none;
  }

  .member-name {
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .member-email {
    color: var(--color-text-muted);
    flex: 1;
  }

  .member-weight {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
