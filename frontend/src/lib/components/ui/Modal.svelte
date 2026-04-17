<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    open: boolean
    onclose?: () => void
    children: Snippet
  }

  let { title, open = $bindable(), onclose, children }: Props = $props()

  // The element that had focus before the modal opened — restored on close
  let triggerEl: Element | null = null
  // Ref to the window panel — used to find focusable children
  let windowEl: HTMLElement | null = $state(null)

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

  // Drag state — offset from the window's default centered position
  let dragX = $state(0)
  let dragY = $state(0)
  let dragging = false
  let dragStartX = 0
  let dragStartY = 0

  function handleTitlebarPointerDown(e: PointerEvent) {
    // Only drag on primary button; ignore clicks on the close button
    if (e.button !== 0 || (e.target as HTMLElement).closest('.close-btn'))
      return
    dragging = true
    dragStartX = e.clientX - dragX
    dragStartY = e.clientY - dragY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handleTitlebarPointerMove(e: PointerEvent) {
    if (!dragging) return
    dragX = e.clientX - dragStartX
    dragY = e.clientY - dragStartY
  }

  function handleTitlebarPointerUp() {
    dragging = false
  }

  $effect(() => {
    // Reset drag position whenever the modal closes
    if (!open) {
      dragX = 0
      dragY = 0
    }
  })

  function getFocusable(): HTMLElement[] {
    return windowEl
      ? Array.from(windowEl.querySelectorAll<HTMLElement>(FOCUSABLE))
      : []
  }

  $effect(() => {
    if (open) {
      // Capture the trigger so we can restore focus when the modal closes
      triggerEl = document.activeElement
      // Move focus into the modal on the next tick (after the DOM renders)
      setTimeout(() => getFocusable()[0]?.focus(), 0)
    } else {
      // Return focus to wherever the user was before opening
      ;(triggerEl as HTMLElement | null)?.focus()
      triggerEl = null
    }
  })

  function close() {
    open = false
    onclose?.()
  }

  function handleBackdropClick(e: MouseEvent) {
    // only close if the click landed on the backdrop itself, not the window
    if (e.target === e.currentTarget) close()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close()
      return
    }

    if (e.key === 'Tab') {
      const focusable = getFocusable()
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        // Shift+Tab: if we're on the first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        // Tab: if we're on the last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
  }
</script>

{#if open}
  <!-- Backdrop — dims the page and catches outside clicks -->
  <div
    class="backdrop"
    role="presentation"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
  >
    <!-- Window panel -->
    <div
      bind:this={windowEl}
      class="window"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      style="transform: translate(calc(-50% + {dragX}px), calc(-50% + {dragY}px))"
    >
      <!-- Title bar — doubles as the drag handle -->
      <div
        class="titlebar"
        role="presentation"
        onpointerdown={handleTitlebarPointerDown}
        onpointermove={handleTitlebarPointerMove}
        onpointerup={handleTitlebarPointerUp}
      >
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
    z-index: 100;
  }

  .window {
    position: absolute;
    top: 50%;
    left: 50%;
    /* default centering — drag adds to this via inline transform */
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
    background: var(--color-titlebar-bg);
    gap: var(--sp-xs);
    user-select: none;
    cursor: grab;
  }

  .titlebar:active {
    cursor: grabbing;
  }

  .titlebar-text {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--color-titlebar-fg);
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
