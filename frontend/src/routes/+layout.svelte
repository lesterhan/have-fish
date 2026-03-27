<script lang="ts">
  import "../styles/tokens.css";
  import "../styles/base.css";
  import { useSession } from "$lib/auth";
  import { theme } from "$lib/theme.svelte";

  let { children } = $props();

  const session = useSession();

  let maximized = $state(false);
  let showQuitDialog = $state(false);
</script>

<div class="desktop" class:maximized>
  <div class="window">
    <div class="titlebar">
      <span class="titlebar-icon">🐟</span>
      <span class="titlebar-title">have-fish</span>
      <div class="titlebar-controls">
        <button class="chrome-btn minimize" aria-label="Minimize">_</button>
        <button
          class="chrome-btn maximize"
          aria-label="Maximize"
          onclick={() => (maximized = !maximized)}
          >{maximized ? "❐" : "□"}</button
        >
        <button
          class="chrome-btn close"
          aria-label="Close"
          onclick={() => (showQuitDialog = true)}>✕</button
        >
      </div>
    </div>

    <nav class="menubar">
      {#if $session.data}
        <a href="/">Dashboard</a>
        <a href="/assets">Assets</a>
        <a href="/transactions">Transactions</a>
        <a href="/import">Import</a>
      {/if}
      <span class="menubar-spacer"></span>
      <button
        class="theme-btn"
        onclick={() => theme.toggle()}
        title="Toggle dark mode"
      >
        {theme.dark ? "☀️" : "🌑"}
      </button>
      {#if $session.data}
        <a href="/settings" class="menubar-settings">
          🔨 {$session.data.user.email}
        </a>
      {:else}
        <a href="/login">Sign in</a>
      {/if}
    </nav>

    <main class="window-body">
      {@render children()}
    </main>

    <div class="statusbar">
      <span>Ready</span>
    </div>
  </div>

  {#if showQuitDialog}
    <div class="dialog-overlay">
      <div class="dialog">
        <div class="dialog-titlebar">
          <span class="titlebar-icon">🐟</span>
          <span>have-fish</span>
        </div>
        <div class="dialog-body">
          <p>Are you sure you want to quit?</p>
          <p class="dialog-sub">Changes are saved.</p>
          <div class="dialog-actions">
            <button class="dialog-btn" onclick={() => window.close()}>
              Yes
            </button>
            <button class="dialog-btn" onclick={() => (showQuitDialog = false)}>
              No
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* --- Desktop --- */
  .desktop {
    height: 100vh;
    overflow: hidden;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: var(--sp-xl);
    background-color: var(--color-desktop);
  }

  .desktop {
    transition: padding var(--duration-normal) var(--ease);
  }

  .desktop.maximized {
    padding: 0;
  }

  /* --- Window --- */
  .window {
    width: 100%;
    max-width: 1100px;
    height: 100%;
    background: var(--color-window);
    box-shadow: var(--shadow-window);
    display: flex;
    flex-direction: column;
  }

  /* --- Title bar --- */
  .titlebar {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: 3px var(--sp-xs);
    background: linear-gradient(
      to right,
      var(--color-titlebar-from),
      var(--color-titlebar-to)
    );
    color: var(--color-titlebar-text);
    user-select: none;
  }

  .titlebar-icon {
    font-size: var(--text-sm);
  }

  .titlebar-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    flex: 1;
  }

  .titlebar-controls {
    display: flex;
    gap: 2px;
  }

  .chrome-btn {
    width: 21px;
    height: 21px;
    background: var(--color-window);
    color: var(--color-text);
    border: none;
    box-shadow: var(--shadow-raised);
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition:
      box-shadow var(--duration-fast) var(--ease),
      background var(--duration-fast) var(--ease);
  }

  .chrome-btn:hover {
    background: var(--color-accent-light);
  }

  .chrome-btn:active {
    box-shadow: var(--shadow-sunken);
  }

  .chrome-btn.close:hover {
    background: var(--color-danger);
    color: var(--color-text-on-dark);
  }

  /* --- Menu bar --- */
  .menubar {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 2px var(--sp-xs);
    background: var(--color-window);
    border-bottom: 1px solid var(--color-bevel-dark);
    font-size: var(--text-sm);
  }

  .menubar a {
    display: inline-block;
    padding: 3px var(--sp-sm);
    color: var(--color-text);
    text-decoration: none;
    background: transparent;
    border: 1px solid transparent;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }

  .menubar a:hover {
    background: var(--color-accent-light);
    border-color: var(--color-accent-mid);
  }

  .menubar a:active {
    background: var(--color-accent-mid);
    color: var(--color-text-on-dark);
  }

  .menubar-spacer {
    flex: 1;
  }

  .menubar-settings {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .theme-btn {
    background: none;
    border: none;
    padding: 2px var(--sp-xs);
    font-size: var(--text-sm);
    line-height: 1;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background var(--duration-fast) var(--ease);
  }

  .theme-btn:hover {
    background: var(--color-accent-light);
  }

  /* --- Window body --- */
  .window-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-lg);
    background: var(--color-window-raised);
    scrollbar-width: auto;
    scrollbar-color: var(--color-window) var(--color-window);
  }

  .window-body::-webkit-scrollbar {
    width: 16px;
  }

  .window-body::-webkit-scrollbar-track {
    background: var(--color-window);
    box-shadow: var(--shadow-sunken);
  }

  .window-body::-webkit-scrollbar-thumb {
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
    min-height: 24px;
  }

  .window-body::-webkit-scrollbar-thumb:hover {
    background: var(--color-window-raised);
  }

  .window-body::-webkit-scrollbar-thumb:active {
    box-shadow: var(--shadow-sunken);
  }

  .window-body::-webkit-scrollbar-button {
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
    display: block;
    height: 16px;
  }

  .window-body::-webkit-scrollbar-button:hover {
    background: var(--color-window-raised);
  }

  .window-body::-webkit-scrollbar-button:active {
    box-shadow: var(--shadow-sunken);
  }

  /* --- Quit dialog --- */
  .dialog-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dialog {
    background: var(--color-window);
    box-shadow: var(--shadow-window);
    min-width: 260px;
  }

  .dialog-titlebar {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: 3px var(--sp-xs);
    background: linear-gradient(
      to right,
      var(--color-titlebar-from),
      var(--color-titlebar-to)
    );
    color: var(--color-titlebar-text);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    user-select: none;
  }

  .dialog-body {
    padding: var(--sp-lg) var(--sp-lg) var(--sp-md);
    font-size: var(--text-sm);
  }

  .dialog-sub {
    color: var(--color-text-muted);
    margin-top: var(--sp-xs);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-sm);
    margin-top: var(--sp-md);
  }

  .dialog-btn {
    min-width: 5rem;
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--color-window);
    color: var(--color-text);
    border: none;
    box-shadow: var(--shadow-raised);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    cursor: pointer;
    transition:
      box-shadow var(--duration-fast) var(--ease),
      background var(--duration-fast) var(--ease);
  }

  .dialog-btn:hover {
    background: var(--color-accent-light);
  }

  .dialog-btn:active {
    box-shadow: var(--shadow-sunken);
  }

  /* --- Status bar --- */
  .statusbar {
    padding: 2px var(--sp-sm);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: var(--color-window);
    border-top: 1px solid var(--color-bevel-dark);
    box-shadow: inset 0 1px 0 var(--color-bevel-light);
  }
</style>
