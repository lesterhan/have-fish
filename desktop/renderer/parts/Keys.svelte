<script lang="ts">
  // An action's shortcut as a keycap. The control it labels carries `aria-keyshortcuts`, so the
  // cap is hidden from a screen reader, which would say it twice. It takes the ink of where it
  // sits, which the contract checks; a fainter one would be a token (see #607).
  import type { KeyedActionId } from '../../shared/actions'
  import { MAC, shortcutText } from '../shortcuts'

  /** An action's shortcut; or `key`, a list's own key that no menu has, such as Enter. */
  let { action, key }: { action: KeyedActionId; key?: never } | { action?: never; key: string } =
    $props()
</script>

<kbd aria-hidden="true">{action ? shortcutText(action, MAC) : key}</kbd>

<style>
  kbd {
    display: inline-block;
    padding: 0 var(--space-1);
    border: var(--border-width) solid color-mix(in oklab, currentColor 35%, transparent);
    border-radius: var(--radius-chip);
    font-family: var(--font-figures);
    font-size: var(--text-key);
    font-variant-numeric: tabular-nums;
    line-height: var(--line-height);
    white-space: nowrap;
  }
</style>
