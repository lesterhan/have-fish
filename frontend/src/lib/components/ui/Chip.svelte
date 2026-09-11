<script lang="ts">
  import Icon from './Icon.svelte'

  interface Props {
    /** Visual weight. `accent` = filled accent badge (700 weight); `muted` = quiet grey badge. */
    tone?: 'accent' | 'muted'
    /** Optional leading icon name (from /static/icons). */
    icon?: string
    size?: 'sm' | 'xs'
    /** Clip overflowing label text with an ellipsis (needs a constrained flex parent). */
    truncate?: boolean
    /** Layout escape hatch for the parent — e.g. `flex-shrink` when chips share a row. */
    style?: string
    children: import('svelte').Snippet
  }

  let {
    tone = 'muted',
    icon,
    size = 'sm',
    truncate = false,
    style,
    children,
  }: Props = $props()
</script>

<span class="chip tone-{tone}" class:xs={size === 'xs'} class:truncate {style}>
  {#if icon}<Icon name={icon} size={size === 'xs' ? 9 : 11} />{/if}
  <span class="label">{@render children()}</span>
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-3xs);
    padding: var(--sp-4xs) var(--sp-2xs);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-rule);
    background: var(--color-window-raised);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-label);
    line-height: var(--leading-none);
    white-space: nowrap;
    min-width: 0;
  }

  .chip.xs {
    font-size: var(--text-micro);
    padding: var(--sp-hair) var(--sp-3xs);
  }

  .tone-accent {
    background: var(--color-accent-chip-bg);
    border-color: var(--color-accent);
    color: var(--color-accent-chip-fg);
    font-weight: var(--weight-bold);
  }

  .label {
    min-width: 0;
  }

  .chip.truncate .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
