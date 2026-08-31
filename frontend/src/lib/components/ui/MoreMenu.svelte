<script lang="ts">
  import GradientButton from './GradientButton.svelte'
  import Icon from './Icon.svelte'

  export type MoreMenuItem = {
    label: string
    /** Icon name from static/icons — omitted renders a blank gutter so labels stay aligned. */
    icon?: string
    onselect: () => void
  }

  interface Props {
    items: MoreMenuItem[]
    tooltip?: string
    /** Which edge the popover hangs from. */
    align?: 'left' | 'right'
  }

  let { items, tooltip = 'More actions', align = 'right' }: Props = $props()

  let open = $state(false)
  let wrapperEl = $state<HTMLDivElement | undefined>(undefined)
  let triggerEl = $state<HTMLDivElement | undefined>(undefined)

  function close(refocus = false) {
    if (!open) return
    open = false
    // The trigger takes focus back, so keyboard users are not dropped at the top of the
    // document after dismissing the menu.
    if (refocus) triggerEl?.querySelector('button')?.focus()
  }

  function choose(item: MoreMenuItem) {
    close()
    item.onselect()
  }

  // mousedown rather than click, so the menu closes before any blur/focus reshuffling —
  // the same reason DateRangeSelector uses it.
  function handleOutsideMousedown(e: MouseEvent) {
    if (!open) return
    if (wrapperEl && !wrapperEl.contains(e.target as Node)) close()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      close(true)
    }
  }

  $effect(() => {
    document.addEventListener('mousedown', handleOutsideMousedown)
    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('mousedown', handleOutsideMousedown)
      document.removeEventListener('keydown', handleKeydown)
    }
  })
</script>

<div class="wrapper" bind:this={wrapperEl}>
  <div bind:this={triggerEl}>
    <GradientButton
      square
      quiet
      active={open}
      {tooltip}
      aria-label={tooltip}
      onclick={() => (open = !open)}
    >
      <span class="dots" aria-hidden="true">···</span>
    </GradientButton>
  </div>

  {#if open}
    <div class="menu" class:left={align === 'left'} role="menu">
      {#each items as item (item.label)}
        <button class="item" role="menuitem" type="button" onclick={() => choose(item)}>
          <span class="item-icon">
            {#if item.icon}<Icon name={item.icon} size={13} />{/if}
          </span>
          {item.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrapper {
    position: relative;
    display: inline-flex;
  }

  .dots {
    font-size: 14px;
    line-height: 1;
    letter-spacing: 1px;
  }

  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 100;
    min-width: 170px;
    padding: var(--sp-xs) 0;
    background: var(--color-window);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-window);
  }

  .menu.left {
    right: auto;
    left: 0;
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    width: 100%;
    padding: 5px var(--sp-sm);
    border: none;
    background: none;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }

  .item:hover {
    background: var(--color-dropdown-active);
    color: var(--color-accent-fg);
  }

  .item:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  /* A fixed gutter so labels line up whether or not an item carries an icon. */
  .item-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    flex-shrink: 0;
    color: var(--color-text-muted);
  }

  .item:hover .item-icon {
    color: inherit;
  }
</style>
