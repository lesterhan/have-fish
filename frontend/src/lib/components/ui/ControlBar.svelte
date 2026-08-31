<script lang="ts">
  import type { Snippet } from 'svelte'

  /**
   * The row of controls above a table: search, a few labelled selects, an action or two.
   *
   * Thin on purpose — it exists so the gap and the label typography are decided once. The
   * two Accounts tabs had already drifted to different values for both, which is what a
   * five-line rule copied into a second file does given one story.
   *
   * A labelled control is `<label class="control"><span>Group</span><Select …/></label>`;
   * this styles it in place rather than wrapping it, so the host keeps its own `aria-label`
   * and binding without a component in between.
   */
  interface Props {
    children: Snippet
  }

  let { children }: Props = $props()
</script>

<div class="bar">{@render children()}</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    flex-wrap: wrap;
  }

  .bar :global(.control) {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  /* Pushed to the far end — a row count, or a trailing action. */
  .bar :global(.trailing) {
    margin-left: auto;
  }
</style>
