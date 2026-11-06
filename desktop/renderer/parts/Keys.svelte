<script lang="ts">
  // An action's shortcut as a keycap. The control it labels carries `aria-keyshortcuts`, so the
  // cap is hidden from a screen reader, which would say it twice. It takes the ink of where it
  // sits, which the contract checks; a fainter one would be a token (see #606).
  import type { KeyedActionId } from '../../shared/actions'
  import { MAC, shortcutText } from '../shortcuts'

  let { action }: { action: KeyedActionId } = $props()
</script>

<kbd aria-hidden="true">{shortcutText(action, MAC)}</kbd>

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
