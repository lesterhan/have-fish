<script lang="ts">
  export type TabItem = {
    id: string
    label: string
    /**
     * Marks a tab whose panel has something wrong behind it. Tabs hide their panels, so an
     * error that used to be visible in a stacked layout can now be one click out of sight —
     * the marker is what keeps it from being silently lost.
     */
    alert?: boolean
  }

  interface Props {
    tabs: TabItem[]
    /** The active tab's id. */
    active: string
    /** Names the tablist for screen readers, e.g. "Account settings sections". */
    label: string
    /** Prefix for the generated panel ids, so `aria-controls` points somewhere real. */
    panelIdPrefix: string
  }

  let { tabs, active = $bindable(), label, panelIdPrefix }: Props = $props()

  let stripEl = $state<HTMLDivElement | undefined>(undefined)

  function focusTab(id: string) {
    active = id
    // The roving tabindex means only the active tab is reachable, so focus has to follow
    // the selection or the keyboard user is left on an element that just left the tab order.
    stripEl?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus()
  }

  // Arrow keys move and activate in one step. Automatic activation is the right default for
  // panels that are already rendered and cheap to swap — nothing here is loaded on demand.
  function handleKeydown(e: KeyboardEvent) {
    const index = tabs.findIndex((t) => t.id === active)
    if (index === -1) return

    let next: number | null = null
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft')
      next = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next === null) return

    // Escape belongs to the modal; the arrows do not, so only these are swallowed.
    e.preventDefault()
    e.stopPropagation()
    focusTab(tabs[next]!.id)
  }
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<!-- The tablist is never focused itself: a roving tabindex puts focus on the active tab,
     which is what the arrow keys move. The handler sits here only to catch the keys as
     they bubble up from those buttons. -->
<div
  class="strip"
  role="tablist"
  aria-label={label}
  bind:this={stripEl}
  onkeydown={handleKeydown}
>
  {#each tabs as tab (tab.id)}
    <button
      type="button"
      class="tab"
      class:active={tab.id === active}
      data-tab={tab.id}
      role="tab"
      id={`${panelIdPrefix}-tab-${tab.id}`}
      aria-selected={tab.id === active}
      aria-controls={`${panelIdPrefix}-panel-${tab.id}`}
      tabindex={tab.id === active ? 0 : -1}
      onclick={() => (active = tab.id)}
    >
      {tab.label}
      {#if tab.alert}
        <span class="alert" aria-label="needs attention">●</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  /* Folder tabs sitting on the panel's top edge — the same shape the spending page uses,
     so the app has one tab language rather than two. */
  .strip {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    border-bottom: 1px solid var(--color-rule);
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    position: relative;
    z-index: 1;
    margin-bottom: -1px;
    padding: 5px 14px;
    border: 1px solid var(--color-rule);
    border-radius: 4px 4px 0 0;
    background: linear-gradient(
      180deg,
      var(--color-rule-soft),
      var(--color-rule)
    );
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: var(--weight-semibold);
    letter-spacing: 0.5px;
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }

  .tab:hover:not(.active) {
    background: linear-gradient(
      180deg,
      var(--color-btn-gradient-hi),
      var(--color-rule-soft)
    );
    color: var(--color-text);
  }

  .tab.active {
    z-index: 2;
    background: linear-gradient(
      180deg,
      var(--color-btn-gradient-hi),
      var(--color-rule-soft)
    );
    /* Erases the shared edge, so the active tab reads as part of the panel below it. */
    border-bottom-color: var(--color-window-raised);
    color: var(--color-text);
  }

  .tab:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
  }

  .alert {
    font-size: 8px;
    line-height: 1;
    color: var(--color-danger);
  }
</style>
