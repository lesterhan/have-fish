<script lang="ts">
  // A place's pane beside its list: what's selected in it, or a form to add one. Below the narrow
  // width it slides over the list, with a way back; the place says when it's open.
  import type { Snippet } from 'svelte'
  import Button from './Button.svelte'

  type Props = {
    label: string
    /** In a narrow window, whether it's over the list. */
    open: boolean
    back: string
    onback: () => void
    title?: Snippet | undefined
    children: Snippet
  }
  let { label, open, back, onback, title, children }: Props = $props()
</script>

<section class="pane" class:open aria-label={label}>
  <span class="back"><Button variant="quiet" onclick={onback}>{back}</Button></span>
  {#if title}<h2>{@render title()}</h2>{/if}
  {@render children()}
</section>

<style>
  .pane {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    min-height: 0;
    padding-inline-start: var(--space-6);
    border-inline-start: var(--border-width) solid var(--color-rule);
    overflow-y: auto;
  }

  h2 {
    margin: 0;
    font-size: var(--text-sentence);
    font-weight: var(--weight-label);
  }

  .back {
    display: none;
  }

  /* NARROW in narrow.ts: below it, the pane slides over the list. */
  @media (max-width: 44rem) {
    .pane {
      position: fixed;
      inset: 0;
      padding: var(--space-4);
      border: none;
      background: var(--color-background);
      transform: translateX(100%);
      visibility: hidden;
      transition:
        transform var(--duration-slide) var(--ease-out),
        visibility 0s linear var(--duration-slide);
    }

    .pane.open {
      transform: none;
      visibility: visible;
      transition: transform var(--duration-slide) var(--ease-out);
    }

    .back {
      display: block;
      justify-self: start;
    }
  }
</style>
