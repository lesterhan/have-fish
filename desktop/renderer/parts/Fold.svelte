<script lang="ts">
  // A question folded away until it's opened: its summary asks it, and what answers it opens
  // under. Closed again, it wasn't asked.
  import type { Snippet } from 'svelte'

  type Props = {
    summary: string
    open?: boolean
    /** Opened or closed, as the element says. */
    ontoggle?: (open: boolean) => void
    children: Snippet
  }
  let { summary, open = $bindable(false), ontoggle, children }: Props = $props()

  let details: HTMLDetailsElement

  /** Whether it's open now: `open` follows the toggle event, which can come later (see #592). */
  export function opened(): boolean {
    return details?.open ?? open
  }
</script>

<details bind:this={details} bind:open ontoggle={(e) => ontoggle?.(e.currentTarget.open)}>
  <summary>{summary}</summary>
  {@render children()}
</details>

<style>
  details {
    display: grid;
    gap: var(--space-2);
  }

  summary {
    cursor: pointer;
  }

  details[open] > summary {
    margin-block-end: var(--space-2);
  }
</style>
