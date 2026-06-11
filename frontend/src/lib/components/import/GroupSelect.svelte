<script lang="ts">
  import { onMount } from 'svelte'
  import { settingsStore } from '$lib/settings.svelte'

  interface Group {
    id: string
    name: string
  }

  interface Props {
    groups: Group[]
    onselect: (groupId: string) => void
    onclose: () => void
  }

  let { groups, onselect, onclose }: Props = $props()

  let listEl: HTMLElement | null = null
  let activeIndex = $state(0)

  let recentGroupIds = $derived(
    settingsStore.value?.preferences?.recentGroups ?? []
  )

  let sortedGroups = $derived.by(() => {
    const recentSet = new Set(recentGroupIds)
    const recents = recentGroupIds
      .map((id) => groups.find((g) => g.id === id))
      .filter((g): g is Group => g !== undefined)
    const others = groups.filter((g) => !recentSet.has(g.id))
    return [...recents, ...others]
  })

  $effect(() => {
    if (activeIndex >= sortedGroups.length) activeIndex = 0
  })

  onMount(() => listEl?.focus())

  function pushRecent(id: string) {
    const current = settingsStore.value?.preferences?.recentGroups ?? []
    const next = [id, ...current.filter((g) => g !== id)].slice(0, 8)
    settingsStore.update({ preferences: { recentGroups: next } }).catch(() => {})
  }

  function select(id: string) {
    pushRecent(id)
    onselect(id)
    onclose()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIndex = (activeIndex + 1) % sortedGroups.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIndex = (activeIndex - 1 + sortedGroups.length) % sortedGroups.length
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const g = sortedGroups[activeIndex]
      if (g) select(g.id)
    } else if (e.key === 'Escape') {
      onclose()
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul
  bind:this={listEl}
  class="group-list"
  role="listbox"
  tabindex="-1"
  onkeydown={handleKeydown}
>
  {#each sortedGroups as g, i}
    <li
      class="group-option"
      class:active={i === activeIndex}
      role="option"
      aria-selected={i === activeIndex}
      onmousedown={(e) => { e.preventDefault(); select(g.id) }}
      onmousemove={() => { activeIndex = i }}
    >
      {g.name}
    </li>
  {/each}
</ul>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  /* Inline list — no positioning math needed. Sits in the cell, expands
     row height to fit. z-index:51 keeps it above the fixed backdrop. */
  .group-list {
    position: relative;
    z-index: 51;
    width: 100%;
    list-style: none;
    margin: 0;
    padding: 2px 0;
    background: var(--color-window);
    border: 1px solid var(--color-accent-mid);
    box-shadow: var(--shadow-window);
    max-height: 180px;
    overflow-y: auto;
    outline: none;
  }

  .group-option {
    padding: 3px 10px;
    font-size: var(--text-sm);
    color: var(--color-text);
    cursor: default;
    white-space: nowrap;
  }

  .group-option.active {
    background: var(--color-accent);
    color: #ffffff;
  }
</style>
