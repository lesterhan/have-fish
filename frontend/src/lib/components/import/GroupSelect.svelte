<script lang="ts">
  import { onMount } from 'svelte'
  import { settingsStore } from '$lib/settings.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
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

  const multiGroup = $derived(groups.length > 1)

  function activeCats(group: ExpenseGroup) {
    return group.categories.filter((c) => !c.archivedAt)
  }

  type Option = { groupId: string; categoryId: string | null; label: string; recent: boolean }
  type Section = { header: string | null; options: (Option & { idx: number })[] }

  // The split key persisted in recents. UUIDs never contain ':', so this round-trips.
  function splitKey(groupId: string, categoryId: string | null) {
    return `${groupId}:${categoryId ?? ''}`
  }

  // Resolve a persisted recent key to a still-valid option (group/category exist,
  // category not archived). Returns null for stale entries so they self-prune.
  function resolveRecent(key: string): Option | null {
    const sep = key.indexOf(':')
    if (sep === -1) return null
    const gid = key.slice(0, sep)
    const cid = key.slice(sep + 1)
    const group = groups.find((g) => g.id === gid)
    if (!group) return null
    if (cid) {
      const cat = activeCats(group).find((c) => c.id === cid)
      if (!cat) return null
      return { groupId: gid, categoryId: cid, label: `${group.name} · ${cat.name}`, recent: true }
    }
    return { groupId: gid, categoryId: null, label: `${group.name} · No category`, recent: true }
  }

  const recentKeys = $derived(settingsStore.value?.preferences?.recentFishPieSplits ?? [])

  // Build display sections plus a flat, index-stamped option list for keyboard nav.
  const built = $derived.by(() => {
    const sections: Section[] = []
    let idx = 0
    const push = (header: string | null, options: Option[]) => {
      if (options.length === 0) return
      sections.push({ header, options: options.map((o) => ({ ...o, idx: idx++ })) })
    }

    // Recent combos only make sense across multiple groups; for a single group the
    // category list below already is the full, short menu.
    if (multiGroup) {
      const recents = recentKeys
        .map(resolveRecent)
        .filter((o): o is Option => o !== null)
        .slice(0, 5)
      push('Recent', recents)
    }

    for (const group of groups) {
      const opts: Option[] = [
        { groupId: group.id, categoryId: null, label: 'No category', recent: false },
        ...activeCats(group).map((c) => ({
          groupId: group.id,
          categoryId: c.id,
          label: c.name,
          recent: false,
        })),
      ]
      push(multiGroup ? group.name : null, opts)
    }

    return { sections, flat: sections.flatMap((s) => s.options) }
  })

  $effect(() => {
    if (activeIndex >= built.flat.length) activeIndex = 0
  })

  onMount(() => {
    // rAF defers until after paint so table layout is settled.
    // The <ul> is already in document.body (via portal action) by this point,
    // so position:fixed is unambiguously viewport-relative with no overflow ancestors.
    requestAnimationFrame(() => {
      if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect()
        const spaceBelow = window.innerHeight - rect.bottom
        if (spaceBelow < 200 && rect.top > spaceBelow) {
          listStyle = `position: fixed; bottom: ${window.innerHeight - rect.top}px; left: ${rect.left}px; width: ${rect.width}px;`
        } else {
          listStyle = `position: fixed; top: ${rect.bottom}px; left: ${rect.left}px; width: ${rect.width}px;`
        }
      }
      listEl?.focus()
    })
  })

  function commit(o: Option) {
    const splits = settingsStore.value?.preferences?.recentFishPieSplits ?? []
    const groupsRecent = settingsStore.value?.preferences?.recentGroups ?? []
    const key = splitKey(o.groupId, o.categoryId)
    settingsStore
      .update({
        preferences: {
          recentFishPieSplits: [key, ...splits.filter((k) => k !== key)].slice(0, 8),
          recentGroups: [o.groupId, ...groupsRecent.filter((g) => g !== o.groupId)].slice(0, 8),
        },
      })
      .catch(() => {})
    onselect(o.groupId, o.categoryId)
    onclose()
  }

  function handleKeydown(e: KeyboardEvent) {
    const n = built.flat.length
    if (n === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      activeIndex = (activeIndex + 1) % n
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      activeIndex = (activeIndex - 1 + n) % n
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const o = built.flat[activeIndex]
      if (o) commit(o)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onclose()
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
<div class="placeholder">{multiGroup ? 'Choose split…' : 'Choose category…'}</div>

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
  {#each built.sections as section (section.header ?? '__only__')}
    {#if section.header}
      <li class="section-header" role="presentation">{section.header}</li>
    {/if}
    {#each section.options as o (o.idx)}
      <li
        class="group-option"
        class:active={o.idx === activeIndex}
        class:lead={o.categoryId === null && !o.recent}
        role="option"
        aria-selected={o.idx === activeIndex}
        onmousedown={(e) => { e.preventDefault(); commit(o) }}
        onmousemove={() => { activeIndex = o.idx }}
      >
        {#if o.recent}<span class="recent-icon"><Icon name="pie" size={10} /></span>{/if}
        {o.label}
      </li>
    {/each}
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
    max-height: 220px;
    overflow-y: auto;
    outline: none;
  }

  .section-header {
    padding: 4px 10px 2px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--color-text-muted);
    border-top: 1px solid var(--color-rule-soft);
  }

  .group-list > .section-header:first-child {
    border-top: none;
  }

  .group-option {
    display: flex;
    align-items: center;
    gap: 5px;
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

  .recent-icon {
    display: inline-flex;
    color: var(--color-accent-mid);
  }

  .group-option.active {
    background: var(--color-accent);
    color: var(--color-accent-fg);
  }

  .group-option.active .recent-icon {
    color: var(--color-accent-fg);
  }
</style>
