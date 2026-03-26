<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    open: boolean
    onclose?: () => void
    children: Snippet
  }

  let { title, open = $bindable(), onclose, children }: Props = $props()

  function close() {
    open = false
    onclose?.()
  }

  function handleBackdropClick(e: MouseEvent) {
    // only close if the click landed on the backdrop itself, not the window
    if (e.target === e.currentTarget) close()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- Backdrop — dims the page and catches outside clicks -->
  <div
    class="backdrop"
    role="presentation"
    onclick={handleBackdropClick}
  >
    <!-- Window panel -->
    <div
      class="window"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <!-- Title bar -->
      <div class="titlebar">
        <span id="modal-title" class="titlebar-text">{title}</span>
        <button class="close-btn" onclick={close} aria-label="Close">✕</button>
      </div>

      <!-- Content area -->
      <div class="body">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    /* centres the window by default */
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .window {
    background: var(--color-window);
    box-shadow: var(--shadow-window);
    min-width: 300px;
    display: flex;
    flex-direction: column;
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3px var(--sp-xs);
    background: linear-gradient(to right, var(--color-titlebar-from), var(--color-titlebar-to));
    gap: var(--sp-xs);
    /* title bar is the drag handle — cursor will change here in the drag story */
    user-select: none;
  }

  .titlebar-text {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-titlebar-text);
    flex: 1;
  }

  .close-btn {
    /* reset button defaults */
    border: none;
    padding: 0;
    line-height: 1;
    cursor: pointer;

    /* XP-style close button: small square with raised bevel */
    width: 16px;
    height: 14px;
    font-size: 9px;
    font-family: var(--font-sans);
    color: var(--color-text);
    background: var(--color-window);
    box-shadow: var(--shadow-raised);

    display: flex;
    align-items: center;
    justify-content: center;

    transition: box-shadow var(--duration-fast) var(--ease);
  }

  .close-btn:hover {
    background: var(--color-window-raised);
  }

  .close-btn:active {
    box-shadow: var(--shadow-sunken);
  }

  .close-btn:focus-visible {
    outline: 1px dotted var(--color-text);
    outline-offset: -2px;
  }

  .body {
    padding: var(--sp-md);
    background: var(--color-window-raised);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
  }
</style>
