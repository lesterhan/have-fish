<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { settingsStore } from '$lib/settings.svelte'
  import type { ExpenseGroup } from '$lib/api'

  interface Props {
    groups: ExpenseGroup[]
    anchorEl: HTMLElement | null // parent td — passed from row component for measurement
    onselect: (groupId: string, categoryId: string | null) => void
    onclose: () => void
  }

  let { groups, anchorEl, onselect, onclose }: Props = $props()

  let listEl: HTMLElement | null = null
  let activeIndex = $state(0)
  // Off-screen until rAF positions it correctly after paint
  let listStyle = $state('position: fixed; top: -9999px; left: -9999px;')

  let recentGroupIds = $derived(settingsStore.value?.preferences?.recentGroups ?? [])

  let sortedGroups = $derived.by(() => {
    const recentSet = new Set(recentGroupIds)
    const recents = recentGroupIds
      .map((id) => groups.find((g) => g.id === id))
      .filter((g): g is ExpenseGroup => g !== undefined)
    const others = groups.filter((g) => !recentSet.has(g.id))
    return [...recents, ...others]
  })

  function activeCats(group: ExpenseGroup) {
    return group.categories.filter((c) => !c.archivedAt)
  }

  // Two stages: pick a group, then pick a category. With a single group we skip
  // straight to its categories so the tap count matches the pre-categories flow.
  let stageGroupId = $state<string | null>(untrack(() => (groups.length === 1 ? groups[0].id : null)))
  const stage = $derived<'groups' | 'categories'>(stageGroupId ? 'categories' : 'groups')
  const stageGroup = $derived(groups.find((g) => g.id === stageGroupId) ?? null)
  const showBack = $derived(stage === 'categories' && groups.length > 1)

  type Item =
    | { kind: 'group'; id: string; label: string }
    | { kind: 'category'; groupId: string; categoryId: string | null; label: string }

  let items = $derived.by<Item[]>(() => {
    if (stage === 'categories' && stageGroup) {
      const lead: Item = { kind: 'category', groupId: stageGroup.id, categoryId: null, label: 'No category' }
      const cats = activeCats(stageGroup).map(
        (c): Item => ({ kind: 'category', groupId: stageGroup.id, categoryId: c.id, label: c.name }),
      )
      return [lead, ...cats]
    }
    return sortedGroups.map((g): Item => ({ kind: 'group', id: g.id, label: g.name }))
  })

  $effect(() => {
    if (activeIndex >= items.length) activeIndex = 0
  })

  onMount(() => {
    // rAF defers until after paint so table layout is settled.
    // The <ul> is already in document.body (via portal action) by this point,
    // so position:fixed is unambiguously viewport-relative with no overflow ancestors.
    requestAnimationFrame(() => {
      if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect()
        const spaceBelow = window.innerHeight - rect.bottom
        if (spaceBelow < 150 && rect.top > spaceBelow) {
          listStyle = `position: fixed; bottom: ${window.innerHeight - rect.top}px; left: ${rect.left}px; width: ${rect.width}px;`
        } else {
          listStyle = `position: fixed; top: ${rect.bottom}px; left: ${rect.left}px; width: ${rect.width}px;`
        }
      }
      listEl?.focus()
    })
  })

  function pushRecent(id: string) {
    const current = settingsStore.value?.preferences?.recentGroups ?? []
    const next = [id, ...current.filter((g) => g !== id)].slice(0, 8)
    settingsStore.update({ preferences: { recentGroups: next } }).catch(() => {})
  }

  function commit(groupId: string, categoryId: string | null) {
    pushRecent(groupId)
    onselect(groupId, categoryId)
    onclose()
  }

  function choose(item: Item) {
    if (item.kind === 'group') {
      const g = groups.find((x) => x.id === item.id)
      if (!g) return
      // Drill into categories only when there's something to choose; otherwise commit.
      if (activeCats(g).length > 0) {
        stageGroupId = g.id
        activeIndex = 0
      } else {
        commit(g.id, null)
      }
    } else {
      commit(item.groupId, item.categoryId)
    }
  }

  function goBack() {
    stageGroupId = null
    activeIndex = 0
  }

  function handleKeydown(e: KeyboardEvent) {
    if (items.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      activeIndex = (activeIndex + 1) % items.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      activeIndex = (activeIndex - 1 + items.length) % items.length
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const item = items[activeIndex]
      if (item) choose(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      // Escape steps back to the group list when we drilled in; otherwise closes.
      if (showBack) goBack()
      else onclose()
    }
  }

  // Teleports the node to document.body so it escapes overflow:auto/hidden
  // ancestors (table-container, window-body) that would clip or misplace it.
  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return {
      destroy() {
        node.remove()
      },
    }
  }
</script>

<!-- Takes up 22px in the cell so the row height doesn't change -->
<div class="placeholder">{stage === 'categories' ? 'Choose category…' : 'Choose group…'}</div>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul
  use:portal
  bind:this={listEl}
  class="group-list"
  style={listStyle}
  role="listbox"
  tabindex="-1"
  onkeydown={handleKeydown}
>
  {#if showBack && stageGroup}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <li class="group-header" onmousedown={(e) => { e.preventDefault(); goBack() }}>
      ‹ {stageGroup.name}
    </li>
  {/if}
  {#each items as item, i (item.kind === 'group' ? item.id : (item.categoryId ?? '__none__'))}
    <li
      class="group-option"
      class:active={i === activeIndex}
      class:lead={item.kind === 'category' && item.categoryId === null}
      role="option"
      aria-selected={i === activeIndex}
      onmousedown={(e) => { e.preventDefault(); choose(item) }}
      onmousemove={() => { activeIndex = i }}
    >
      {item.label}
    </li>
  {/each}
</ul>

<style>
  .placeholder {
    height: 22px;
    display: flex;
    align-items: center;
    padding: 0 var(--sp-xs);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-muted);
    background: var(--color-window-inset);
    border: 1px solid var(--color-accent-mid);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 2px var(--color-accent-light);
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  .group-list {
    z-index: 100;
    list-style: none;
    margin: 0;
    padding: 2px 0;
    background: var(--color-window);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-window);
    max-height: 180px;
    overflow-y: auto;
    outline: none;
  }

  .group-header {
    padding: 3px 10px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--color-text-muted);
    cursor: pointer;
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .group-header:hover {
    color: var(--color-accent-mid);
  }

  .group-option {
    padding: 3px 10px;
    font-size: var(--text-sm);
    color: var(--color-text);
    cursor: default;
    white-space: nowrap;
  }

  .group-option.lead {
    color: var(--color-text-muted);
    font-style: italic;
  }

  .group-option.active {
    background: var(--color-accent);
    color: #ffffff;
  }
</style>
