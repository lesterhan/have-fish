<script lang="ts">
  import "../styles/tokens.css";
  import "../styles/base.css";
  import { signOut, useSession } from "$lib/auth";
  import { goto } from "$app/navigation";

  let { children } = $props();

  const session = useSession();

  async function handleSignOut() {
    await signOut();
    goto("/login");
  }
</script>

<div class="desktop">
  <div class="window">
    <div class="titlebar">
      <span class="titlebar-icon">🐟</span>
      <span class="titlebar-title">have-fish</span>
      <div class="titlebar-controls">
        <button class="chrome-btn minimize" aria-label="Minimize">_</button>
        <button class="chrome-btn maximize" aria-label="Maximize">□</button>
        <button class="chrome-btn close" aria-label="Close">✕</button>
      </div>
    </div>

    <nav class="menubar">
      <a href="/">Dashboard</a>
      <a href="/accounts">Accounts</a>
      <a href="/transactions">Transactions</a>
      <a href="/import">Import</a>
      <a href="/settings">Settings</a>
      <span class="menubar-spacer"></span>
      {#if $session.data}
        <span class="menubar-user">{$session.data.user.email}</span>
        <button class="menubar-signout" onclick={handleSignOut}>Sign out</button
        >
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

  .menubar a,
  .menubar-signout {
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

  .menubar a:hover,
  .menubar-signout:hover {
    background: var(--color-accent-light);
    border-color: var(--color-accent-mid);
  }

  .menubar a:active,
  .menubar-signout:active {
    background: var(--color-accent-mid);
    color: var(--color-text-on-dark);
  }

  .menubar-spacer {
    flex: 1;
  }

  .menubar-user {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    padding: 0 var(--sp-sm);
  }

  .menubar-signout {
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  /* --- Window body --- */
  .window-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-lg);
    background: var(--color-window-raised);
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
