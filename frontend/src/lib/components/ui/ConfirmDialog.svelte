<script lang="ts">
  import type { Snippet } from 'svelte'
  import GradientButton from './GradientButton.svelte'
  import Modal from './Modal.svelte'

  /**
   * A modal that asks before doing something, and says what the something is.
   *
   * The shape was already written twice in one file — say what will happen, Cancel, confirm
   * — so it is a component rather than a pattern to remember. The body is a snippet because
   * the interesting half of a confirm is the specifics: which rows a rename rewrites, which
   * path is about to go.
   */
  interface Props {
    title: string
    /** Bound so the host can close it from its own state. */
    open: boolean
    /** The verb, e.g. "Rename all" or "Delete". */
    confirmLabel: string
    /** Shown in place of the label while the action is in flight. */
    busyLabel?: string
    busy?: boolean
    /** `warning` for a destructive confirm; `primary` for everything else. */
    variant?: 'primary' | 'warning'
    onconfirm: () => void
    oncancel?: () => void
    children: Snippet
  }

  let {
    title,
    open = $bindable(false),
    confirmLabel,
    busyLabel,
    busy = false,
    variant = 'primary',
    onconfirm,
    oncancel,
    children,
  }: Props = $props()

  function cancel() {
    open = false
    oncancel?.()
  }
</script>

<Modal {title} bind:open onclose={oncancel}>
  <div class="confirm">
    {@render children()}
    <div class="actions">
      <GradientButton disabled={busy} onclick={cancel}>Cancel</GradientButton>
      <GradientButton {variant} disabled={busy} onclick={onconfirm}>
        {busy && busyLabel ? busyLabel : confirmLabel}
      </GradientButton>
    </div>
  </div>
</Modal>

<style>
  .confirm {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    max-width: 32rem;
  }

  .confirm :global(p) {
    margin: 0;
    font-size: var(--text-sm);
  }

  .confirm :global(code) {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-sm);
  }
</style>
