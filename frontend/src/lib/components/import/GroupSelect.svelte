<script lang="ts">
  import { onMount } from 'svelte'
  import { settingsStore } from '$lib/settings.svelte'

  interface Group {
    id: string
    name: string
  }

  interface Props {
    groups: Group[]
    anchorEl: HTMLElement | null  // parent td — passed from row component for measurement
    onselect: (groupId: string) => void
    onclose: () => void
  }

  let { groups, anchorEl, onselect, onclose }: Props = $props()

  let listEl: HTMLElement | null = null
  let activeIndex = $state(0)
  // Off-screen until rAF positions it correctly after paint
  let listStyle = $state('position: fixed; top: -9999px; left: -9999px;')

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

  // Teleports the node to document.body so it escapes overflow:auto/hidden
  // ancestors (table-container, window-body) that would clip or misplace it.
  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return {
      destroy() { node.remove() }
    }
  }
</script>

<!-- Takes up 22px in the cell so the row height doesn't change -->
<div class="placeholder">Choose group…</div>

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
