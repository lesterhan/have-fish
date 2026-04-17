<script lang="ts">
  interface Props {
    code: string
    size?: 'xs' | 'sm'
  }

  let { code, size = 'sm' }: Props = $props()
</script>

<span class="pill" class:xs={size === 'xs'}>{code.toUpperCase()}</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 10px;
    line-height: 1;
    padding: 2px 5px;
    background: var(--color-accent-chip-bg);
    color: var(--color-accent-chip-fg);
    border: 1px solid color-mix(in srgb, var(--color-accent-chip-fg) 30%, transparent);
    border-radius: 2px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .pill.xs {
    font-size: 9px;
    padding: 1px 4px;
  }
</style>
