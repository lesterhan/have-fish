<script lang="ts">
  // A row's details, attached under it and lifted with it (DESIGN.md, "Card"): what it holds,
  // then a foot band with its actions at the end. The list places it; Listbox makes the room.
  import type { Snippet } from 'svelte'

  type Props = {
    label: string
    children: Snippet
    /** Where it came from, at the foot's start. */
    where?: Snippet
    /** The actions, at the end of the foot. */
    foot: Snippet
    onkeydown?: (event: KeyboardEvent) => void
  }
  let { label, children, where, foot, onkeydown }: Props = $props()
</script>

<!-- Keys bubble up from the fields inside; the card itself never takes focus. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="card" aria-label={label} {onkeydown}>
  <div class="body">{@render children()}</div>
  <div class="foot">
    {#if where}<div class="where">{@render where()}</div>{/if}
    <div class="actions">{@render foot()}</div>
  </div>
</section>

<style>
  .card {
    display: grid;
    border-radius: 0 0 var(--radius-card) var(--radius-card);
    background: var(--color-card);
    box-shadow: var(--shadow-lift);
    animation: open var(--duration-open) var(--ease-out);
  }

  .body {
    padding: var(--space-4);
    /* The details read as a sentence; the words between the chips are quiet. */
    font-size: var(--text-sentence);
    line-height: 1.55;
  }

  .body :global(.lead) {
    color: var(--color-muted);
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: 0 0 var(--radius-card) var(--radius-card);
    background: var(--color-band);
  }

  .where {
    min-width: 0;
    margin-inline-end: auto;
    color: var(--color-muted);
    font-size: var(--text-quiet);
  }

  .where :global(code) {
    font-family: var(--font-code);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-inline-start: auto;
  }

  @keyframes open {
    from {
      opacity: 0;
      translate: 0 calc(-1 * var(--space-1));
    }
  }
</style>
