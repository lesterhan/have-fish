<script lang="ts">
  import { onMount } from 'svelte'

  interface Group {
    id: string
    name: string
  }

  interface Props {
    groups: Group[]
    anchorEl: HTMLElement | null  // the parent td — measured after paint for stable coordinates
    onselect: (groupId: string) => void
    onclose: () => void
  }

  let { groups, anchorEl, onselect, onclose }: Props = $props()

  let listEl: HTMLElement | null = null
  let activeIndex = $state(0)
  let listStyle = $state('position: fixed; top: -9999px; left: -9999px;')

  onMount(() => {
    // rAF defers until after the browser paints the current frame, guaranteeing
    // the table has settled and getBoundingClientRect() returns stable coordinates.
    requestAnimationFrame(() => {
      const ref = anchorEl
      if (ref) {
        const rect = ref.getBoundingClientRect()
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIndex = (activeIndex + 1) % groups.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIndex = (activeIndex - 1 + groups.length) % groups.length
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const g = groups[activeIndex]
      if (g) { onselect(g.id); onclose() }
    } else if (e.key === 'Escape') {
      onclose()
    }
  }
</script>

<div class="placeholder"></div>
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul
  bind:this={listEl}
  class="group-list"
  style={listStyle}
  role="listbox"
  tabindex="-1"
  onkeydown={handleKeydown}
>
  {#each groups as g, i}
    <li
      class="group-option"
      class:active={i === activeIndex}
      role="option"
      aria-selected={i === activeIndex}
      onmousedown={(e) => { e.preventDefault(); onselect(g.id); onclose() }}
      onmousemove={() => { activeIndex = i }}
    >
      {g.name}
    </li>
  {/each}
</ul>

<style>
  .placeholder {
    height: 22px;
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
