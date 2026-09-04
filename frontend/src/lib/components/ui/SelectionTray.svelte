<script lang="ts">
  import type { Snippet } from 'svelte'
  import GradientButton from './GradientButton.svelte'

  /**
   * A tray of actions for the rows a user has selected, anchored to the bottom of the
   * scroll container with the list running underneath it.
   *
   * It floats because the alternative displaces: the accounts bulk bar used to be a card in
   * normal flow above the table, so ticking one checkbox pushed every row down ~60px and
   * unticking pulled them back — the worst layout shift in the app, on the most incidental
   * interaction there is. Selecting a group while scrolled down was worse still: the actions
   * you had just enabled appeared ~850px above the viewport, out of sight.
   *
   * Growing the status bar instead would trade the shift for a subtler one — `.window-body`
   * is `flex: 1`, so a taller bar shrinks the scroll viewport mid-interaction and the
   * scrollbar jumps. Floating resizes nothing at all. See DESIGN.md §2.
   *
   * It sits last in the scrolled content rather than outside it, which is what keeps the
   * rows above from moving when it appears, and what lets it settle below the final row
   * instead of covering it once you reach the bottom.
   */
  interface Props {
    /** Authoritative — the tray only ever offers what the host will actually act on. */
    count: number
    /** Names what was selected, for the region label and the count. */
    noun?: string
    onclear: () => void
    /** The bulk actions themselves. The tray owns placement, the host owns the verbs. */
    children: Snippet
  }

  let { count, noun = 'selected', onclear, children }: Props = $props()

  let el = $state<HTMLElement | undefined>(undefined)

  // Shadow only while there is content underneath: pinned over the list it reads as
  // floating, and settled at the end of the list it reads as part of the page.
  let overContent = $state(false)

  function scrollParent(node: HTMLElement): HTMLElement | null {
    let p = node.parentElement
    while (p) {
      const oy = getComputedStyle(p).overflowY
      if (oy === 'auto' || oy === 'scroll') return p
      p = p.parentElement
    }
    return null
  }

  $effect(() => {
    if (!el) return
    const scroller = scrollParent(el)
    if (!scroller) return

    const update = () => {
      overContent =
        scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1
    }

    // Both the viewport and the content can change without a scroll event — a filter that
    // shortens the list settles the tray without the user moving.
    const ro = new ResizeObserver(update)
    ro.observe(scroller)
    if (el.parentElement) ro.observe(el.parentElement)
    scroller.addEventListener('scroll', update, { passive: true })
    update()

    return () => {
      scroller.removeEventListener('scroll', update)
      ro.disconnect()
    }
  })
</script>

<div
  class="tray"
  class:floating={overContent}
  bind:this={el}
  role="region"
  aria-label={`${count} ${noun}`}
>
  <span class="count">{count} {noun}</span>
  {@render children()}
  <GradientButton quiet size="lg" onclick={onclear}>
    Clear <span class="key">Esc</span>
  </GradientButton>
</div>

<style>
  .tray {
    position: sticky;
    bottom: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-sm);
    /* ~48px around 32px targets: the height the story asks for, and enough for the
       tray to read as a surface rather than a strip. */
    min-height: 48px;
    padding: var(--sp-xs) var(--sp-md);
    background: var(--color-accent-light);
    border: 1px solid var(--color-accent-mid);
    border-radius: var(--radius-lg);
    /* Settled at the end of the list it is just the last card; the shadow is what says
       "there is more underneath me". */
    box-shadow: none;
    transition: box-shadow var(--duration-fast) var(--ease);
  }

  .tray.floating {
    box-shadow: var(--shadow-window);
  }

  .count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }

  /* Pushes Clear to the far end, away from the actions it would be a misclick on. */
  .tray :global(> :last-child) {
    margin-left: auto;
  }

  .key {
    font-family: var(--font-mono);
    font-size: 9px;
    padding: 1px 4px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-window);
  }
</style>
