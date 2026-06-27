<script lang="ts">
  import Chip from './Chip.svelte'

  interface Props {
    /** Accent (hero) label — the category, or the group when uncategorized. */
    category: string
    /** Muted secondary label — the group, shown only when it adds info beyond the category. */
    group?: string | null
    /** Muted share hint (e.g. "12.50 CAD"), shown when a per-person split is known. */
    share?: string | null
    /** Layout escape hatch for the parent (e.g. `flex-shrink`). */
    style?: string
  }

  let { category, group = null, share = null, style }: Props = $props()
</script>

<span class="fp-tag" {style}>
  <Chip tone="accent" icon="pie" truncate style="flex-shrink: 1">{category}</Chip>
  {#if group}
    <Chip tone="muted" truncate style="flex-shrink: 2">{group}</Chip>
  {/if}
  {#if share}
    <Chip tone="muted" icon="pie-chart" style="flex-shrink: 0">{share}</Chip>
  {/if}
</span>

<style>
  .fp-tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
  }
</style>
