<script lang="ts">
  // The places, each with its keycap: down the left, or across the top below the narrow width.
  import { copy } from '../../copy'
  import { PLACES, type Place, SHOW } from '../places'
  import { ariaShortcut, MAC } from '../shortcuts'
  import Keys from './Keys.svelte'

  type Props = { current: Place; ongo: (place: Place) => void }
  let { current, ongo }: Props = $props()
</script>

<nav aria-label={copy.app.places.label}>
  {#each PLACES as p (p)}
    <button
      type="button"
      aria-current={current === p ? 'page' : undefined}
      aria-keyshortcuts={ariaShortcut(SHOW[p], MAC)}
      onclick={() => ongo(p)}
    >
      {copy.app.places[p]}
      <Keys action={SHOW[p]} />
    </button>
  {/each}
</nav>

<style>
  nav {
    display: grid;
    align-content: start;
    gap: var(--space-1);
    inline-size: 176px;
    box-sizing: border-box;
    padding: var(--space-3) var(--space-2);
    border-inline-end: var(--border-width) solid var(--color-rule);
    background: var(--color-sidebar);
  }

  button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border: none;
    border-radius: var(--radius-control);
    font: inherit;
    font-size: var(--text-quiet);
    color: var(--color-text);
    background: transparent;
    text-align: start;
    cursor: pointer;
  }

  button:hover {
    background: var(--color-band);
  }

  button[aria-current='page'] {
    font-weight: var(--weight-label);
    background: var(--color-selected);
  }

  /* NARROW in narrow.ts: the places go across the top. */
  @media (max-width: 44rem) {
    nav {
      grid-auto-flow: column;
      justify-content: start;
      inline-size: auto;
      padding: var(--space-2) var(--space-3);
      border-inline-end: none;
      border-block-end: var(--border-width) solid var(--color-rule);
      overflow-x: auto;
    }
  }
</style>
