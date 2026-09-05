<script lang="ts">
  import { PUBLIC_VERSION } from '$env/static/public'
  import '../styles/tokens.css'
  import '../styles/base.css'
  import Sidebar from '$lib/components/Sidebar.svelte'
  import { goto } from '$app/navigation'
  import { signOut, useSession } from '$lib/auth'
  import { toast } from '$lib/toast.svelte'
  import { fetchAccounts, fetchAccountPostingCounts, fetchCoverageStatus } from '$lib/api'
  import type { Account } from '$lib/api'
  import { completeness, statusNote } from '$lib/coverage'
  import { onCoverageChange } from '$lib/coverageRefresh'
  import sidebarRefresh from '$lib/sidebarRefresh.svelte'
  import { settingsStore } from '$lib/settings.svelte'
  import { actionRequiredStore } from '$lib/actionRequired.svelte'
  import Icon from '$lib/components/ui/Icon.svelte'
  import ChromeButton from '$lib/components/ui/ChromeButton.svelte'
  import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte'
  import CashConfetti from '$lib/components/ui/CashConfetti.svelte'
  import { applyAccent } from '$lib/accent'
  import type { AccentKey } from '$lib/accent'
  import AccentPicker from '$lib/components/AccentPicker.svelte'
  import { theme } from '$lib/theme.svelte'

  let { children } = $props()

  const session = useSession()

  let maximized = $state(true)
  let showSignOutDialog = $state(false)
  let signingOut = $state(false)
  let mobileSidebarOpen = $state(false)
  let pickerOpen = $state(false)
  let currentAccent = $state<AccentKey>('aqua')

  // Sidebar data — the sidebar renders immediately and fills in after the fetch. Balances are
  // no longer among them: the sidebar stopped listing accounts, so it stopped needing what
  // they hold. Last activity is what Recent ranks on.
  let sidebarAccounts = $state<Account[]>([])
  let lastActivityById = $state<Map<string, string | null>>(new Map())

  // The status bar's readout: how far the whole ledger is actually recorded. Computed with the
  // same helper the accounts page tiles use, so the bar and the tiles can never disagree about
  // the same accounts.
  let coverageStatus = $state<{ today: string; note: ReturnType<typeof statusNote> } | null>(null)

  // Bumped by every coverage write in the app, wherever it happens. The subscription is the
  // rune-free module's half of the contract: it has no state of its own, so the reactivity
  // lives here.
  let coverageEpoch = $state(0)
  $effect(() => onCoverageChange(() => coverageEpoch++))

  // Reading `$session.data` keeps this from firing before there is a session to fetch for.
  $effect(() => {
    coverageEpoch
    if (!$session.data) {
      coverageStatus = null
      return
    }
    void fetchCoverageStatus()
      .then((payload) => {
        coverageStatus = {
          today: payload.today,
          note: statusNote(completeness(payload.accounts), payload.today),
        }
      })
      // The bar is on every screen; a failed fetch leaves it empty rather than taking the app
      // down or, worse, leaving a stale date on screen that reads as current.
      .catch(() => {
        coverageStatus = null
      })
  })

  // $effect re-runs when $session.data changes, so the fetch fires as soon as
  // Better Auth resolves the session — not at mount time when it may still be null.
  // The fetched flag prevents re-fetching if the session object is refreshed.
  let sidebarFetched = false
  $effect(() => {
    // Signing out clears the flag as well as the lists. Without it the next sign-in — which
    // may be a different person — reuses whatever the last session left in the sidebar,
    // because this component is the root layout and is never torn down between the two.
    if (!$session.data) {
      sidebarFetched = false
      sidebarAccounts = []
      lastActivityById = new Map()
      return
    }
    if (!sidebarFetched) {
      sidebarFetched = true
      Promise.all([
        fetchAccounts(),
        fetchAccountPostingCounts(),
        settingsStore.load(),
        actionRequiredStore.load(),
      ]).then(([accts, counts, settings]) => {
        sidebarAccounts = accts
        lastActivityById = new Map(counts.map((c) => [c.accountId, c.lastActivity]))
        currentAccent = settings.preferences.accentColor ?? 'aqua'
        applyAccent(currentAccent, theme.dark)
      })
    }
  })

  // Re-apply accent whenever the theme toggles so dark variants kick in immediately.
  $effect(() => {
    applyAccent(currentAccent, theme.dark)
  })

  // Re-read the sidebar's lists whenever a page signals a mutation. Not balances any more —
  // what can go stale here is the account list itself and, for Recent, last activity.
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    sidebarRefresh.count // subscribe
    if (!sidebarFetched) return
    Promise.all([fetchAccounts(), fetchAccountPostingCounts()]).then(
      ([accts, counts]) => {
        sidebarAccounts = accts
        lastActivityById = new Map(counts.map((c) => [c.accountId, c.lastActivity]))
      },
    )
  })

  async function handleSignOut() {
    if (signingOut) return
    signingOut = true
    try {
      await signOut()
    } catch {
      // The session may already be gone server-side; either way the user asked to leave,
      // so the navigation below still happens rather than stranding them in a dialog.
    }
    await goto('/login')
    signingOut = false
    showSignOutDialog = false
  }

  function closeMobileSidebar() {
    mobileSidebarOpen = false
  }

  function handleAccentSelect(key: AccentKey) {
    currentAccent = key
    applyAccent(key, theme.dark)
    pickerOpen = false
    // Fire-and-forget: the accent is already applied locally, and this call can now
    // reject rather than silently corrupting the store.
    settingsStore
      .update({ preferences: { accentColor: key } })
      .catch(() => toast.show('Accent saved for this session only.'))
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
          <ChromeButton
            class="hamburger"
            onclick={() => (mobileSidebarOpen = true)}
            aria-label="Open menu"
          >
            <Icon name="menu" size={12} />
          </ChromeButton>
        {/if}
        <ChromeButton
          variant="maximize"
          aria-label="Maximize"
          onclick={() => (maximized = !maximized)}
        >
          <Icon name={maximized ? 'restore-window' : 'maximize'} size={12} />
        </ChromeButton>
        {#if $session.data}
          <!-- Only where it means something: on the login screen there is no session to end,
               and a close button that would open a dialog about nothing is the exact thing
               this epic is about. -->
          <ChromeButton
            variant="close"
            aria-label="Sign out"
            onclick={() => (showSignOutDialog = true)}
          >
            <Icon name="close" size={12} />
          </ChromeButton>
        {/if}
      </div>
    </div>

    <div class="window-body">
      {#if $session.data}
        <Sidebar
          accounts={sidebarAccounts}
          {lastActivityById}
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

    <!-- The version moved from the (deleted) "Ready" label to the bar itself, so it is still
         one hover away without the bar carrying a widget that reports nothing. -->
    <div class="statusbar" title={PUBLIC_VERSION}>
      {#if coverageStatus?.note}
        <a class="statusbar-trust" href="/catch-up" title={coverageStatus.note.detail}>
          {coverageStatus.note.text}
        </a>
      {/if}
      {#if toast.message}
        <span class="statusbar-toast">{toast.message}</span>
      {/if}
    </div>
  </div>

  <CashConfetti />

  <!-- The titlebar's close button. "Quit" has no meaning in a browser tab, so the control
       carries the nearest true one. The dialog stays because the misclick costs whatever you
       were part-way through typing, and there is no undo for that. -->
  <ConfirmDialog
    title="have-fish"
    bind:open={showSignOutDialog}
    confirmLabel="Sign out"
    busyLabel="Signing out…"
    busy={signingOut}
    variant="primary"
    onconfirm={handleSignOut}
  >
    <p>Sign out of have-fish?</p>
    <p class="dialog-sub">Any unsaved entry on this page will be lost.</p>
  </ConfirmDialog>
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
    background: linear-gradient(135deg, #007070 0%, #008080 50%, #006858 100%);
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

  /* Restored (non-maximized): float as a windowed panel on the classic teal desktop */
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

  .titlebar-title {
    font-family: var(--font-serif);
    font-size: 13px;
    font-weight: var(--weight-semibold);
    letter-spacing: 0.01em;
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

  /* Hamburger — hidden on desktop, visible on mobile only */
  :global(.chrome-btn.hamburger) {
    display: none;
  }

  @media (max-width: 600px) {
    /* Show hamburger, hide window management buttons on mobile */
    :global(.chrome-btn.hamburger) {
      display: flex;
    }

    :global(.chrome-btn.maximize),
    :global(.chrome-btn.close) {
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
    padding: 0;
    background: var(--color-window-raised);
    min-width: 0; /* prevent flex blowout */
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


  }

  /* The dialog's own furniture comes from ConfirmDialog; this is the one line of it that is
     ours — the consequence, under the question at a lower weight. No margin: the body is a
     flex column and its gap already spaces the two lines like every other confirm. */
  .dialog-sub {
    color: var(--color-text-muted);
  }

  /* --- Status bar --- */
  /* Tall enough to act in. The bar now holds a link, so it clears WCAG 2.5.8's 24x24 minimum
     target rather than the ~20px strip that shipped — period-plausible either way, since Aqua
     status bars ran taller whenever they carried controls. 30px rather than the minimum 28,
     so the focus ring has somewhere to sit: the bar clips its overflow, and a 24px target with
     a 2px ring exactly fills 28. The height is paid once at load and never animates: the case
     does not change size (DESIGN.md §2). */
  .statusbar {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    min-height: 30px;
    padding: 0 var(--sp-sm);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: var(--color-window);
    border-top: 1px solid var(--color-border);
    box-shadow: var(--shadow-titlebar-inset);
  }

  /* A statement, not an alarm: muted, upright, no icon. It is a link because it goes
     somewhere, so the keyboard and the focus ring come for free. */
  .statusbar-trust {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    color: inherit;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .statusbar-trust:hover {
    color: var(--color-text);
    text-decoration: underline;
  }

  .statusbar-trust:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    /* Outside the text rather than through it — a negative offset draws the ring over the
       first and last characters in a strip this tight. */
    outline-offset: 2px;
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
