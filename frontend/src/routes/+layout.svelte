<script lang="ts">
  import '../styles/tokens.css'
  import '../styles/base.css'
  import Sidebar from '$lib/components/Sidebar.svelte'
  import { useSession } from '$lib/auth'
  import { toast } from '$lib/toast.svelte'
  import { fetchAccountBalances } from '$lib/api'
  import type { AccountBalance, UserSettings } from '$lib/api'
  import sidebarRefresh from '$lib/sidebarRefresh.svelte'
  import { settingsStore } from '$lib/settings.svelte'
  import { actionRequiredStore } from '$lib/actionRequired.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import CashConfetti from '$lib/components/ui/CashConfetti.svelte'
  import { applyAccent } from '$lib/accent'
  import type { AccentKey } from '$lib/accent'
  import AccentPicker from '$lib/components/AccentPicker.svelte'

  let { children } = $props()

  const session = useSession()

  let maximized = $state(true)
  let showQuitDialog = $state(false)
  let mobileSidebarOpen = $state(false)
  let pickerOpen = $state(false)
  let currentAccent = $state<AccentKey>('aqua')

  const settingsDefault: UserSettings = {
    id: '',
    userId: '',
    defaultOffsetAccountId: null,
    defaultConversionAccountId: null,
    defaultAdjustmentsAccountId: null,
    defaultAssetsRootPath: 'assets',
    defaultLiabilitiesRootPath: 'liabilities',
    defaultExpensesRootPath: 'expenses',
    defaultEquityRootPath: 'equity',
    preferredCurrency: 'CAD',
    preferences: {},
    createdAt: '',
    updatedAt: '',
  }

  // Sidebar data — defaults let the sidebar render immediately; populated after fetch
  let sidebarAccounts = $state<AccountBalance[]>([])
  let sidebarSettings = $derived(settingsStore.value ?? settingsDefault)

  // $effect re-runs when $session.data changes, so the fetch fires as soon as
  // Better Auth resolves the session — not at mount time when it may still be null.
  // The fetched flag prevents re-fetching if the session object is refreshed.
  let sidebarFetched = false
  $effect(() => {
    if ($session.data && !sidebarFetched) {
      sidebarFetched = true
      Promise.all([
        fetchAccountBalances(),
        settingsStore.load(),
        actionRequiredStore.load(),
      ]).then(([accts, settings]) => {
        sidebarAccounts = accts
        currentAccent = settings.preferences.accentColor ?? 'aqua'
        applyAccent(currentAccent)
      })
    }
  })

  // Re-fetch sidebar balances whenever a page signals a mutation.
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    sidebarRefresh.count // subscribe
    if (!sidebarFetched) return
    fetchAccountBalances().then((accts) => {
      sidebarAccounts = accts
    })
  })

  function closeMobileSidebar() {
    mobileSidebarOpen = false
  }

  function handleAccentSelect(key: AccentKey) {
    currentAccent = key
    applyAccent(key)
    pickerOpen = false
    settingsStore.update({ preferences: { accentColor: key } })
  }
</script>

<svelte:head>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<div class="desktop" class:maximized>
  <div class="window">
    <div class="titlebar">
      {#if $session.data}
        <div class="titlebar-pill-wrap">
          <button
            class="titlebar-pill"
            aria-label="Choose accent color"
            aria-expanded={pickerOpen}
            onclick={() => (pickerOpen = !pickerOpen)}
          >
            <span class="pill-dot"></span>
          </button>
          {#if pickerOpen}
            <AccentPicker
              current={currentAccent}
              onselect={handleAccentSelect}
              onclose={() => (pickerOpen = false)}
            />
          {/if}
        </div>
      {/if}
      <span class="titlebar-title">have-fish</span>
      <div class="titlebar-controls">
        {#if $session.data}
          <!-- Mobile hamburger — lives in titlebar, hidden on desktop -->
          <button
            class="chrome-btn hamburger"
            onclick={() => (mobileSidebarOpen = true)}
            aria-label="Open menu"
          >
            <Icon name="menu" size={12} />
          </button>
        {/if}
        <button class="chrome-btn minimize" aria-label="Minimize">
          <Icon name="minimize" size={12} />
        </button>
        <button
          class="chrome-btn maximize"
          aria-label="Maximize"
          onclick={() => (maximized = !maximized)}
        >
          <Icon name={maximized ? 'restore-window' : 'maximize'} size={12} />
        </button>
        <button
          class="chrome-btn close"
          aria-label="Close"
          onclick={() => (showQuitDialog = true)}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>

    <div class="window-body">
      {#if $session.data}
        <Sidebar
          accounts={sidebarAccounts}
          settings={sidebarSettings}
          email={$session.data.user.email}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={closeMobileSidebar}
        />
      {/if}

      <div class="content">
        {@render children()}
      </div>

      <!-- Mobile sidebar backdrop -->
      {#if mobileSidebarOpen}
        <div
          class="mobile-backdrop"
          role="presentation"
          onclick={closeMobileSidebar}
        ></div>
      {/if}
    </div>

    <div class="statusbar">
      <span class="statusbar-ready">Ready</span>
      {#if toast.message}
        <span class="statusbar-toast">{toast.message}</span>
      {/if}
    </div>
  </div>

  <CashConfetti />

  {#if showQuitDialog}
    <div class="dialog-overlay">
      <div class="dialog">
        <div class="dialog-titlebar">
          <span class="titlebar-icon">🧧</span>
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
    transition: padding 150ms var(--ease);
  }

  .desktop.maximized {
    padding: 0;
  }

  /* --- Window --- */
  .window {
    width: 100%;
    max-width: 100vw;
    height: 100%;
    background: var(--color-window);
    box-shadow: var(--shadow-window);
    display: flex;
    flex-direction: column;
    transition: max-width 150ms var(--ease);
  }

  /* Restored (non-maximized): float as a windowed panel on the teal desktop */
  .desktop:not(.maximized) .window {
    max-width: 1100px;
  }

  /* --- Title bar --- */
  .titlebar {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    padding: 3px var(--sp-xs);
    background: var(--color-titlebar-bg);
    color: var(--color-titlebar-fg);
    user-select: none;
    position: relative;
  }

  .titlebar-icon {
    font-size: var(--text-sm);
  }

  .titlebar-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    flex: 1;
  }

  .titlebar-pill-wrap {
    position: relative;
  }

  .titlebar-pill {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    background: none;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: var(--radius-xl);
    cursor: pointer;
    padding: 0;
    transition: filter var(--duration-fast) var(--ease);
  }

  .titlebar-pill:hover {
    filter: brightness(1.2);
  }

  .pill-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-titlebar-accent);
    display: block;
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

  /* Hamburger — hidden on desktop, visible on mobile only */
  .chrome-btn.hamburger {
    display: none;
  }

  @media (max-width: 600px) {
    /* Show hamburger, hide window management buttons on mobile */
    .chrome-btn.hamburger {
      display: flex;
    }

    .chrome-btn.minimize,
    .chrome-btn.maximize,
    .chrome-btn.close {
      display: none;
    }
  }

  /* --- Window body — flex row: sidebar + content --- */
  .window-body {
    flex: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
    background: var(--color-window);
    position: relative; /* for mobile backdrop */
  }

  /* --- Content area — the scrolling pane to the right of the sidebar --- */
  .content {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-lg);
    background: var(--color-window-raised);
    min-width: 0; /* prevent flex blowout */
    scrollbar-width: auto;
    scrollbar-color: var(--color-window) var(--color-window);
  }

  .content::-webkit-scrollbar {
    width: 16px;
  }

  .content::-webkit-scrollbar-track {
    background: var(--color-window);
    box-shadow: var(--shadow-sunken);
  }

  .content::-webkit-scrollbar-thumb {
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
    min-height: 24px;
  }

  .content::-webkit-scrollbar-thumb:hover {
    background: var(--color-window-raised);
  }

  .content::-webkit-scrollbar-thumb:active {
    box-shadow: var(--shadow-sunken);
  }

  .content::-webkit-scrollbar-button {
    background: var(--color-window);
    box-shadow: var(--shadow-raised);
    display: block;
    height: 16px;
  }

  .content::-webkit-scrollbar-button:hover {
    background: var(--color-window-raised);
  }

  .content::-webkit-scrollbar-button:active {
    box-shadow: var(--shadow-sunken);
  }

  /* --- Mobile backdrop (closes sidebar on outside click) --- */
  .mobile-backdrop {
    display: none;
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 199; /* just below sidebar's z-index: 200 */
  }

  @media (max-width: 600px) {
    .mobile-backdrop {
      display: block;
    }

    /* On mobile, content takes full width (sidebar is an overlay) */
    .content {
      padding: var(--sp-md);
    }
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
    background: var(--color-titlebar-bg);
    color: var(--color-titlebar-fg);
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
    position: relative;
    overflow: hidden;
    padding: 2px var(--sp-sm);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: var(--color-window);
    border-top: 1px solid var(--color-bevel-dark);
    box-shadow: inset 0 1px 0 var(--color-bevel-light);
  }

  .statusbar-ready {
    display: block;
  }

  .statusbar-toast {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding: 0 var(--sp-sm);
    color: var(--color-text);
    background: var(--color-success-light);
    white-space: nowrap;
    animation: statusbar-toast 3000ms var(--ease) forwards;
  }

  @keyframes statusbar-toast {
    0% {
      transform: translateY(100%);
    }
    10% {
      transform: translateY(0);
    }
    80% {
      transform: translateY(0);
    }
    100% {
      transform: translateY(-100%);
    }
  }
</style>
