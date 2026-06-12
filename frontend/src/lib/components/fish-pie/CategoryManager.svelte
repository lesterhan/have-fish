<script lang="ts">
  import {
    createGroupCategory,
    updateGroupCategory,
    setCategoryMyMapping,
    setCategoryWeights,
  } from '$lib/api'
  import type { Account, GroupCategory, GroupMember } from '$lib/api'
  import {
    suggestAccountId,
    weightsToPct,
    pctToVector,
  } from '$lib/fish-pie-categories'
  import { untrack } from 'svelte'
  import { toast } from '$lib/toast.svelte'
  import TextInput from '$lib/components/ui/TextInput.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import AccountPathInput from '$lib/components/accounts/AccountPathInput.svelte'

  interface Props {
    groupId: string
    members: GroupMember[]
    currentUserId: string
    accounts: Account[]
    categories: GroupCategory[]
  }

  let { groupId, members, currentUserId, accounts, categories }: Props = $props()

  // Take a snapshot of the initial categories; this component owns the list afterwards
  // and updates it in place as the user edits (the parent loads the group only once).
  let cats = $state<GroupCategory[]>(untrack(() => [...categories]))
  let newName = $state('')
  let adding = $state(false)

  // Per-row UI state, keyed by category id, kept in sync with `cats` below.
  let mappingValue = $state<Record<string, string>>({})
  let sliderPct = $state<Record<string, number>>({})

  // Whether this group's split is editable as a simple two-person slider. The app's
  // share UI is two-member throughout (the index page makes the same assumption); for
  // any other size we hide the weight editor rather than invent a multi-member control.
  const isPair = $derived(members.length === 2)

  // Seed/refresh the row state whenever the category list changes.
  $effect(() => {
    const nextMapping: Record<string, string> = {}
    const nextSlider: Record<string, number> = {}
    for (const cat of cats) {
      nextMapping[cat.id] = cat.myMapping?.accountId ?? ''
      if (isPair) {
        nextSlider[cat.id] = weightsToPct(cat.weights, members[0].userId, members[1].userId) ?? 50
      }
    }
    mappingValue = nextMapping
    sliderPct = nextSlider
  })

  const active = $derived(cats.filter((c) => !c.archivedAt))
  const archived = $derived(cats.filter((c) => c.archivedAt))

  function replaceCat(updated: GroupCategory) {
    cats = cats.map((c) => (c.id === updated.id ? updated : c))
  }

  async function handleAdd() {
    const name = newName.trim()
    if (!name || adding) return
    adding = true
    try {
      const created = await createGroupCategory(groupId, name)
      cats = [...cats, created]
      newName = ''
      toast.show(`Added “${created.name}”`)
    } catch {
      toast.show('Failed to add category')
    } finally {
      adding = false
    }
  }

  async function handleRename(cat: GroupCategory, value: string) {
    const name = value.trim()
    if (!name || name === cat.name) return
    try {
      replaceCat(await updateGroupCategory(groupId, cat.id, { name }))
    } catch {
      toast.show('Failed to rename category')
    }
  }

  async function handleArchiveToggle(cat: GroupCategory) {
    try {
      replaceCat(await updateGroupCategory(groupId, cat.id, { archived: !cat.archivedAt }))
    } catch {
      toast.show('Failed to update category')
    }
  }

  async function handleMappingCommit(cat: GroupCategory, accountId: string) {
    if (!accountId) return
    try {
      const res = await setCategoryMyMapping(groupId, cat.id, accountId)
      replaceCat({ ...cat, myMapping: { accountId: res.accountId } })
      toast.show('Account updated')
    } catch {
      toast.show('Failed to set account')
    }
  }

  function suggestionFor(cat: GroupCategory): Account | null {
    if (cat.myMapping) return null
    const id = suggestAccountId(cat.name, accounts)
    return id ? (accounts.find((a) => a.id === id) ?? null) : null
  }

  async function handleSliderChange(cat: GroupCategory) {
    if (!isPair) return
    const vector = pctToVector(sliderPct[cat.id] ?? 50, members[0].userId, members[1].userId)
    try {
      replaceCat(await setCategoryWeights(groupId, cat.id, vector))
      toast.show('Split updated')
    } catch {
      toast.show('Failed to update split')
    }
  }

  async function handleResetWeights(cat: GroupCategory) {
    try {
      replaceCat(await setCategoryWeights(groupId, cat.id, []))
      toast.show('Split reset to group default')
    } catch {
      toast.show('Failed to reset split')
    }
  }

  function hasWeights(cat: GroupCategory): boolean {
    return cat.weights.length > 0
  }
</script>

<div class="categories">
  {#if active.length === 0}
    <p class="empty">No categories yet. Add one below to start tagging expenses.</p>
  {/if}

  {#each active as cat (cat.id)}
    {@const suggestion = suggestionFor(cat)}
    <div class="cat-row">
      <div class="cat-head">
        <TextInput
          value={cat.name}
          onblur={(e) => handleRename(cat, (e.target as HTMLInputElement).value)}
          onkeydown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          style="width: 200px; font-weight: 600"
        />
        <button class="link-btn" onclick={() => handleArchiveToggle(cat)}>Archive</button>
      </div>

      <div class="cat-field">
        <span class="cat-field-label">My account</span>
        <div class="cat-field-input">
          <AccountPathInput
            {accounts}
            bind:value={mappingValue[cat.id]}
            placeholder="Uncategorized (default)"
            allowCreate={true}
            oncommit={(id) => handleMappingCommit(cat, id)}
          />
          {#if !cat.myMapping}
            {#if suggestion}
              <button class="suggest" onclick={() => handleMappingCommit(cat, suggestion.id)}>
                Suggested: <code>{suggestion.path}</code> · Use
              </button>
            {:else}
              <span class="cat-hint">No account set — your share posts to the default.</span>
            {/if}
          {/if}
        </div>
      </div>

      {#if isPair}
        <div class="cat-field">
          <span class="cat-field-label">Split</span>
          <div class="cat-field-input">
            <div class="split-labels">
              <span>{members[0].userName} {Math.round(sliderPct[cat.id] ?? 50)}%</span>
              <span class="split-divider">/</span>
              <span>{Math.round(100 - (sliderPct[cat.id] ?? 50))}% {members[1].userName}</span>
            </div>
            <input
              type="range"
              class="split-track"
              min="1"
              max="99"
              step="1"
              bind:value={sliderPct[cat.id]}
              onchange={() => handleSliderChange(cat)}
            />
            <div class="split-foot">
              {#if hasWeights(cat)}
                <button class="link-btn" onclick={() => handleResetWeights(cat)}>Use group default</button>
              {:else}
                <span class="cat-hint">Using the group default split.</span>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/each}

  <div class="add-row">
    <TextInput
      bind:value={newName}
      placeholder="New category (e.g. Food)"
      onkeydown={(e) => e.key === 'Enter' && handleAdd()}
      style="width: 200px"
    />
    <GradientButton onclick={handleAdd} disabled={adding || !newName.trim()}>Add category</GradientButton>
  </div>

  {#if archived.length > 0}
    <div class="archived">
      <span class="archived-title">Archived</span>
      {#each archived as cat (cat.id)}
        <div class="archived-row">
          <span class="archived-name">{cat.name}</span>
          <button class="link-btn" onclick={() => handleArchiveToggle(cat)}>Unarchive</button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .categories {
    display: flex;
    flex-direction: column;
  }

  .empty {
    padding: var(--sp-md) 22px;
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    font-style: italic;
    color: var(--color-text-muted);
    margin: 0;
  }

  .cat-row {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    padding: var(--sp-md) 22px;
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .cat-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-md);
  }

  .cat-field {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-md);
  }

  .cat-field-label {
    width: 64px;
    flex-shrink: 0;
    padding-top: 5px;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-family: var(--font-mono);
  }

  .cat-field-input {
    flex: 1;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .cat-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .suggest {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    font-size: var(--text-xs);
    color: var(--color-accent-mid);
    cursor: pointer;
  }

  .suggest:hover {
    text-decoration: underline;
  }

  .suggest code {
    font-family: var(--font-mono);
  }

  .link-btn {
    background: none;
    border: none;
    padding: 0;
    font-size: var(--text-xs);
    color: var(--color-accent-mid);
    cursor: pointer;
  }

  .link-btn:hover {
    text-decoration: underline;
  }

  .split-labels {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-xs);
    color: var(--color-text);
  }

  .split-divider {
    color: var(--color-text-muted);
  }

  .split-track {
    width: 100%;
  }

  .split-foot {
    min-height: 14px;
  }

  .add-row {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: var(--sp-md) 22px;
    background: var(--color-window);
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .archived {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
    padding: var(--sp-md) 22px;
    background: var(--color-window-raised);
  }

  .archived-title {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-family: var(--font-mono);
    margin-bottom: 2px;
  }

  .archived-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    opacity: 0.7;
  }

  .archived-name {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
</style>
