<script lang="ts">
  // A part of the card's sentence (DESIGN.md, "Parts"): at rest a chip; hovered and focused it
  // steps up; opened, it becomes its own editor in place; just saved, it flashes the accent and
  // settles with a tick; locked, it has a dashed edge and doesn't open. A refused change keeps it
  // open, underlined, with why.
  import type { Snippet } from 'svelte'

  type Props = {
    /** Its accessible name: the part it changes. */
    label: string
    /** Its element id, so focus can find it again after its editor closes. */
    id?: string
    /** Opened: the editor shows in its place. */
    changing?: boolean
    /** Just saved: the accent flash and a tick. */
    saved?: boolean
    /** Can't be changed here: a dashed edge, and Enter does nothing. */
    locked?: boolean
    /** In figures: an amount, a day. */
    figures?: boolean
    /** Why the last save was refused: underlined, and the words under it. */
    error?: string | null
    onopen?: () => void
    /** Its flash has ended: the tick can go. */
    onflashed?: () => void
    editor?: Snippet
    children: Snippet
  }
  let {
    label,
    id,
    changing = false,
    saved = false,
    locked = false,
    figures = false,
    error = null,
    onopen,
    onflashed,
    editor,
    children,
  }: Props = $props()
</script>

{#if changing}
  <span class="chip changing" class:figures class:refused={!!error}>
    {@render editor?.()}
    {#if error}<span class="why" role="alert">{error}</span>{/if}
  </span>
{:else}
  <button
    {id}
    type="button"
    class="chip"
    class:figures
    class:saved
    class:locked
    disabled={locked}
    aria-label={label}
    onclick={() => onopen?.()}
    onanimationend={(event) => {
      if (saved && event.target === event.currentTarget) onflashed?.()
    }}
  >
    {@render children()}
    {#if saved}<span class="tick" aria-hidden="true">✓</span>{/if}
  </button>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-chip);
    background: var(--color-band);
    font: inherit;
    color: inherit;
    line-height: inherit;
    vertical-align: middle;
    cursor: default;
  }

  button.chip:hover {
    background: var(--color-selected);
  }

  button.chip:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .figures {
    font-family: var(--font-figures);
    font-variant-numeric: tabular-nums;
  }

  .figures :global(.figure) {
    font-weight: 600;
  }

  .locked {
    border-style: dashed;
    border-color: var(--color-border);
    background: transparent;
  }

  .changing {
    display: inline-grid;
    justify-items: start;
    gap: var(--space-1);
    padding: 0;
    background: none;
    border-color: transparent;
  }

  .changing.refused {
    padding: var(--space-1) var(--space-2);
    border-color: var(--color-error);
    background: var(--color-background);
  }

  .changing :global(input),
  .changing :global(select) {
    min-width: 0;
    font: inherit;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-accent);
    border-radius: var(--radius-control);
    color: inherit;
    background: var(--color-background);
  }

  .changing.refused :global(input),
  .changing.refused :global(select) {
    border-color: var(--color-error);
  }

  .why {
    font-size: var(--text-small);
    color: var(--color-error);
  }

  /* The flash settles into the band it rests on; the tick stays while it shows. */
  .saved {
    animation: saved var(--duration-flash) var(--ease-out);
  }

  .tick {
    color: var(--color-accent);
    font-weight: 600;
  }

  @keyframes saved {
    0%,
    25% {
      background: var(--color-selected);
    }
  }
</style>
