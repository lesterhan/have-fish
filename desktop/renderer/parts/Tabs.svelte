<script module lang="ts">
  export type Tab = { id: string; label: string }
</script>

<script lang="ts">
  // A place's views across its top, the ARIA tab pattern: ← → move and choose, Home and End.
  import { tabAfter } from './tabs'

  type Props = {
    title: string
    tabs: readonly Tab[]
    selected: string
    onselect: (id: string) => void
    id: string
  }
  let { title, tabs, selected, onselect, id }: Props = $props()

  let buttons: HTMLButtonElement[] = $state([])

  function key(event: KeyboardEvent, at: number) {
    const to = tabAfter(event.key, at, tabs.length)
    if (to === null) return
    const tab = tabs[to]
    if (tab === undefined) return
    event.preventDefault()
    onselect(tab.id)
    buttons[to]?.focus()
  }
</script>

<h1 class="unseen" id="{id}-title">{title}</h1>
<div class="tabs" role="tablist" aria-labelledby="{id}-title">
  {#each tabs as tab, i (tab.id)}
    <button
      bind:this={buttons[i]}
      type="button"
      role="tab"
      id="{id}-tab-{tab.id}"
      aria-controls="{id}-panel-{tab.id}"
      aria-selected={tab.id === selected}
      tabindex={tab.id === selected ? 0 : -1}
      onclick={() => onselect(tab.id)}
      onkeydown={(e) => key(e, i)}>{tab.label}</button
    >
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    border-block-end: var(--border-width) solid var(--color-rule);
  }

  button {
    position: relative;
    padding: var(--space-2) var(--space-4);
    padding-block-start: calc(var(--space-2) + var(--radius-control) - var(--border-width));
    margin-block-end: calc(-1 * var(--border-width));
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-control) var(--radius-control) 0 0;
    font: inherit;
    font-size: var(--text-quiet);
    color: var(--color-muted);
    background: transparent;
    cursor: pointer;
  }

  button:hover {
    color: var(--color-text);
    background: var(--color-band);
  }

  button[aria-selected='true'] {
    color: var(--color-text);
    font-weight: var(--weight-label);
    border-color: var(--color-rule);
    border-block-end-color: var(--color-background);
    background: var(--color-background);
  }

  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  /* The cap: as tall as the corner is round, so it holds the whole curve and never thins. */
  button[aria-selected='true']::before {
    content: '';
    position: absolute;
    inset-block-start: calc(-1 * var(--border-width));
    inset-inline: calc(-1 * var(--border-width));
    block-size: var(--radius-control);
    border-radius: var(--radius-control) var(--radius-control) 0 0;
    background: var(--color-accent-cap);
  }

  .unseen {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
