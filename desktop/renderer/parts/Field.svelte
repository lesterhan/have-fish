<script lang="ts">
  // A field: its label, the control, and under it what the control means or why it was refused.
  // The control is the caller's, handed the ids that describe it; how an input in it looks is the
  // field's. The ids are `<id>-note` and `<id>-error`.
  import type { Snippet } from 'svelte'

  type Props = {
    /** The control's id, which the label names. */
    id: string
    label: string
    /** Beside the label: the keycap that comes here. */
    keys?: Snippet | undefined
    /** Why the last save was refused, if it was about this. */
    error?: string | null | undefined
    /** Said under it: what was typed means. Keeps its line while empty, so nothing jumps. */
    note?: Snippet | undefined
    /** In figures: an amount, a date. */
    figures?: boolean
    children: Snippet<[describedby: string | undefined]>
  }
  let { id, label, keys, error, note, figures = false, children }: Props = $props()

  const describedby = $derived(
    [error ? `${id}-error` : '', note ? `${id}-note` : ''].filter(Boolean).join(' ') || undefined,
  )
</script>

<div class="field" class:figures class:refused={!!error}>
  <label for={id}>{label}{#if keys}{' '}{@render keys()}{/if}</label>
  {@render children(describedby)}
  {#if note}<p class="note" id={`${id}-note`}>{@render note()}</p>{/if}
  {#if error}<p class="error" id={`${id}-error`} role="alert">{error}</p>{/if}
</div>

<style>
  .field {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  label {
    font-size: var(--text-quiet);
    color: var(--color-muted);
  }

  label :global(kbd) {
    margin-inline-start: var(--space-1);
  }

  .field :global(input) {
    min-width: 0;
    font: inherit;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-control);
    color: inherit;
    background: transparent;
  }

  /* The control and what's beside it, such as an amount's currency. */
  .figures > :global(:not(label, p)) {
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
  }

  .refused :global(input) {
    border-color: var(--color-error);
  }

  p {
    margin: 0;
  }

  .note {
    min-height: 1lh;
    font-size: var(--text-quiet);
    color: var(--color-muted);
  }

  .error {
    font-size: var(--text-small);
    color: var(--color-error);
  }
</style>
