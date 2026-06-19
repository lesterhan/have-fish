<script lang="ts">
  import type { Snippet } from 'svelte'

  // Aqua-style card surface (the gloss alternative to the XP bevel): flat panel on a
  // soft drop shadow with a faint glossy top highlight, hairline border, whisper of
  // rounding. Surface only — lay out the contents in the children, since cards differ
  // (row vs column, padded vs self-padding headers).
  interface Props {
    // Top-light gradient + hover elevation — for selectable / interactive cards.
    gloss?: boolean
    // Flattened + dimmed — e.g. a deselected/excluded card.
    muted?: boolean
    class?: string
    children: Snippet
    [key: string]: unknown
  }

  let { gloss = false, muted = false, class: klass = '', children, ...rest }: Props = $props()
</script>

<div class="card {klass}" class:card--gloss={gloss} class:card--muted={muted} {...rest}>
  {@render children()}
</div>

<style>
  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border-color);
    border-radius: var(--card-radius);
    box-shadow: var(--card-shadow);
    transition:
      box-shadow var(--duration-fast) var(--ease),
      opacity var(--duration-fast) var(--ease),
      background var(--duration-fast) var(--ease);
  }

  .card--gloss {
    background: linear-gradient(180deg, var(--color-window-inset), var(--color-window));
  }

  .card--gloss:hover {
    box-shadow: var(--card-shadow-hover);
  }

  .card--muted {
    opacity: 0.55;
    background: var(--color-window-raised);
    box-shadow: none;
  }

  .card--muted:hover {
    box-shadow: none;
  }
</style>
