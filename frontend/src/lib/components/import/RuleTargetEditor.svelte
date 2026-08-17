<script lang="ts">
  import AccountPicker from '$lib/components/accounts/AccountPicker.svelte'
  import Select from '$lib/components/ui/Select.svelte'
  import type { Account, ExpenseGroup } from '$lib/api'

  interface Props {
    accounts: Account[]
    groups: ExpenseGroup[]
    // Exactly one of these is meaningful at a time; switching kind clears the other, so a
    // half-filled form can't post a body the backend rejects for having both targets.
    accountId: string
    groupId: string | null
    categoryId: string | null
    onaccountcreated: (account: Account) => void
  }

  let {
    accounts,
    groups,
    accountId = $bindable(),
    groupId = $bindable(),
    categoryId = $bindable(),
    onaccountcreated,
  }: Props = $props()

  let kind = $state<'account' | 'split'>(groupId ? 'split' : 'account')

  function selectKind(next: 'account' | 'split') {
    if (kind === next) return
    kind = next
    if (next === 'account') {
      groupId = null
      categoryId = null
    } else {
      accountId = ''
      // Pre-select the only group when there is one — the picker would be a formality.
      if (!groupId && groups.length === 1) groupId = groups[0].id
    }
  }

  let activeGroup = $derived(groups.find((g) => g.id === groupId))
  // Archived categories are excluded: a rule targeting one would create expenses the user
  // can no longer categorize by hand, and the backend rejects it anyway.
  let categories = $derived(activeGroup?.categories.filter((c) => !c.archivedAt) ?? [])
</script>

<div class="target-editor">
  {#if groups.length > 0}
    <div class="kind-switch" role="group" aria-label="Rule target kind">
      <button
        type="button"
        class="kind"
        class:active={kind === 'account'}
        aria-pressed={kind === 'account'}
        onclick={() => selectKind('account')}>Account</button
      >
      <button
        type="button"
        class="kind"
        class:active={kind === 'split'}
        aria-pressed={kind === 'split'}
        onclick={() => selectKind('split')}>Split</button
      >
    </div>
  {/if}

  {#if kind === 'account'}
    <AccountPicker
      {accounts}
      bind:value={accountId}
      placeholder="Select account…"
      oncreate={onaccountcreated}
    />
  {:else}
    <div class="split-fields">
      <Select
        value={groupId ?? ''}
        aria-label="Group"
        onchange={(e) => {
          groupId = (e.currentTarget as HTMLSelectElement).value || null
          // A category belongs to one group, so changing group invalidates it.
          categoryId = null
        }}
      >
        <option value="">Select group…</option>
        {#each groups as group (group.id)}
          <option value={group.id}>{group.name}</option>
        {/each}
      </Select>

      {#if categories.length > 0}
        <Select
          value={categoryId ?? ''}
          aria-label="Category"
          onchange={(e) => {
            categoryId = (e.currentTarget as HTMLSelectElement).value || null
          }}
        >
          <option value="">Uncategorized</option>
          {#each categories as category (category.id)}
            <option value={category.id}>{category.name}</option>
          {/each}
        </Select>
      {/if}
    </div>
  {/if}
</div>

<style>
  .target-editor {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .target-editor :global(.wrapper) {
    flex: 1;
  }

  .kind-switch {
    display: inline-flex;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-control);
    overflow: hidden;
    flex-shrink: 0;
  }

  .kind {
    padding: 3px 9px;
    border: 1px solid var(--color-border);
    background: var(--color-window-raised);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }

  .kind + .kind {
    border-left: none;
  }

  .kind:hover {
    color: var(--color-text);
  }

  .kind.active {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-accent-fg);
    box-shadow: var(--shadow-inset);
  }

  .kind:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .split-fields {
    display: flex;
    gap: var(--sp-xs);
    flex: 1;
  }
</style>
