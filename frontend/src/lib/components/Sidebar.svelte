<script lang="ts">
  import { afterNavigate } from '$app/navigation'
  import { page } from '$app/state'
  import { theme } from '$lib/theme.svelte'
  import { tooltip } from '$lib/tooltip'
  import { settingsStore } from '$lib/settings.svelte'
  import { actionRequiredStore } from '$lib/actionRequired.svelte'
  import { rootsFrom } from '$lib/components/accounts/accountPaths'
  import AccountJumpPalette from '$lib/components/accounts/AccountJumpPalette.svelte'
  import {
    pinnedRows,
    recentRows,
    type SidebarAccount,
  } from '$lib/components/accounts/sidebarAccounts'
  import Icon from './ui/Icon.svelte'

  /**
   * A launcher, not an index.
   *
   * This used to render every balance-bearing account grouped by type, each row carrying a
   * stack of currency pills — 21 accounts became 19 lines and 19 pills, and finding the one
   * you wanted meant reading all of them. Accounts live on /accounts now. What is left here
   * is the handful you chose (Pinned), the handful you have been using (Recent), and Ctrl+K
   * for everything else.
   */
  interface Props {
    /** Every account, for the jump palette. Balances are no longer needed or fetched. */
    accounts: SidebarAccount[]
    /** Account id → YYYY-MM-DD of its latest transaction. Drives Recent. */
    lastActivityById: ReadonlyMap<string, string | null>
    email?: string
    mobileOpen?: boolean
    onMobileClose?: () => void
  }

  let {
    accounts,
    lastActivityById,
    email,
    mobileOpen = false,
    onMobileClose,
  }: Props = $props()

  afterNavigate(() => onMobileClose?.())

  let currentPath = $derived(page.url.pathname)
  let expanded = $state(true)
  let paletteOpen = $state(false)

  let roots = $derived(rootsFrom(settingsStore.value))

  let pinnedIds = $derived(
    settingsStore.value?.preferences.pinnedAccountIds ?? [],
  )
  let hiddenIds = $derived(
    new Set(settingsStore.value?.preferences.hiddenAccountIds ?? []),
  )

  let actionRequiredIds = $derived(
    new Set(
      (actionRequiredStore.value ?? [])
        .filter((e) => e.count > 0)
        .map((e) => e.accountId),
    ),
  )

  let pinned = $derived(pinnedRows(accounts, pinnedIds, roots))
  let recent = $derived(
    recentRows(accounts, lastActivityById, roots, {
      pinnedIds: new Set(pinnedIds),
      hiddenIds,
    }),
  )
</script>

<aside
  class="sidebar"
  class:collapsed={!expanded}
  class:mobile-open={mobileOpen}
>
  <div class="sidebar-inner">
    <!-- Top nav — always rendered so icons show in collapsed state -->
    <div class="top-nav">
      <a
        href="/accounts"
        class="nav-link"
        class:active={currentPath.startsWith('/accounts')}
        use:tooltip={'Accounts'}
      >
        <Icon name="accounts" size={16} />
        <span class="nav-label">Accounts</span>
      </a>
      <a
        href="/spending"
        class="nav-link"
        class:active={currentPath.startsWith('/spending')}
        use:tooltip={'Spending'}
      >
        <Icon name="spending" size={16} />
        <span class="nav-label">Spending</span>
      </a>
      <a
        href="/budgeting"
        class="nav-link"
        class:active={currentPath.startsWith('/budgeting')}
        use:tooltip={'Budgeting'}
      >
        <Icon name="piggy-bank" size={16} />
        <span class="nav-label">Budgeting</span>
      </a>
      <a
        href="/fish-pie"
        class="nav-link"
        class:active={currentPath.startsWith('/fish-pie')}
        use:tooltip={'Fish Pie'}
      >
        <Icon name="pie" size={16} />
        <span class="nav-label">Fish Pie</span>
      </a>
      <a
        href="/catch-up"
        class="nav-link"
        class:active={currentPath.startsWith('/catch-up')}
        use:tooltip={'Catch Up'}
      >
        <Icon name="calendar" size={16} />
        <span class="nav-label">Catch Up</span>
      </a>
      <a
        href="/import"
        class="nav-link"
        class:active={currentPath.startsWith('/import')}
        use:tooltip={'Import + Export'}
      >
        <Icon name="import-export" size={16} />
        <span class="nav-label">Import + Export</span>
      </a>
      <a
        href="/transactions"
        class="nav-link"
        class:active={currentPath.startsWith('/transactions')}
        use:tooltip={'Transactions'}
      >
        <Icon name="transactions" size={16} />
        <span class="nav-label">Transactions</span>
      </a>
      <!--
        <a href="/dashboard" class="nav-link nav-link-wip" use:tooltip={'Dashboard [WIP]'}>
          <Icon name="dashboard" size={16} />
          <span class="nav-label">Dashboard [WIP]</span>
        </a>
        -->
    </div>

    {#if expanded || mobileOpen}
      <div class="lists">
        <button class="jump" type="button" onclick={() => (paletteOpen = true)}>
          <Icon name="search" size={13} />
          <span class="jump-label">Jump to account</span>
          <span class="jump-key">Ctrl K</span>
        </button>

        {#if pinned.length > 0}
          <section class="list">
            <h2 class="list-header">Pinned</h2>
            <ul class="account-list">
              {#each pinned as row (row.id)}
                <li>
                  <a
                    href="/account/{row.id}"
                    class="account-row"
                    class:active={currentPath === `/account/${row.id}`}
                    title={row.path}
                  >
                    <span class="account-name">{row.label}</span>
                    {#if actionRequiredIds.has(row.id)}
                      <span class="action-dot" title="Needs attention"></span>
                    {/if}
                  </a>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if recent.length > 0}
          <section class="list">
            <h2 class="list-header">Recent</h2>
            <ul class="account-list">
              {#each recent as row (row.id)}
                <li>
                  <a
                    href="/account/{row.id}"
                    class="account-row"
                    class:active={currentPath === `/account/${row.id}`}
                    title={row.path}
                  >
                    <span class="account-name">{row.label}</span>
                    {#if actionRequiredIds.has(row.id)}
                      <span class="action-dot" title="Needs attention"></span>
                    {/if}
                  </a>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if pinned.length === 0 && recent.length === 0}
          <p class="lists-empty">
            Pin accounts on the <a href="/accounts">Accounts</a> page to keep them here.
          </p>
        {/if}
      </div>
    {/if}

    <!-- Footer: collapse toggle + theme + settings — always rendered so icons show collapsed -->
    <div class="sidebar-footer">
      <!-- Desktop: compress / expand toggle -->
      <button
        class="footer-btn footer-collapse"
        onclick={() => (expanded = !expanded)}
        aria-label={expanded ? 'Compress sidebar' : 'Expand sidebar'}
        use:tooltip={expanded ? 'Compress sidebar' : 'Expand sidebar'}
      >
        {#if expanded}
          <Icon name="collapse-sidebar" size={16} />
          <span class="nav-label">Compress sidebar</span>
        {:else}
          <Icon name="menu" size={16} />
        {/if}
      </button>
      <!-- Mobile: close sidebar -->
      <button
        class="footer-btn footer-mobile-close"
        onclick={() => onMobileClose?.()}
        aria-label="Close sidebar"
      >
        <Icon name="close" size={16} />
        <span class="nav-label">Close</span>
      </button>
      <button
        class="footer-btn"
        onclick={() => theme.toggle()}
        use:tooltip={theme.dark ? 'Light Theme' : 'Dark Theme'}
      >
        <Icon name={theme.dark ? 'sun' : 'moon'} size={16} />
        <span class="nav-label"
          >{theme.dark ? 'Light Theme' : 'Dark Theme'}</span
        >
      </button>
      {#if email}
        <a
          href="/settings"
          class="footer-btn footer-settings"
          use:tooltip={'Settings'}
        >
          <Icon name="user" size={16} />
          <span class="nav-label">{email}</span>
        </a>
      {/if}
    </div>
  </div>
</aside>

<AccountJumpPalette {accounts} initial={[...pinned, ...recent]} bind:open={paletteOpen} />

<style>
  /* --- Sidebar shell --- */

  .sidebar {
    width: 200px;
    flex-shrink: 0;
    background: var(--color-sidebar);
    border-right: 1px solid var(--color-sidebar-border);
    display: flex;
    flex-direction: column;
    transition: width var(--duration-normal) var(--ease);
    overflow: hidden;
  }

  .sidebar.collapsed {
    width: 48px;
  }

  .sidebar-inner {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 200px; /* prevents wrapping during collapse animation */
  }

  /* --- Mobile overlay --- */

  @media (max-width: 600px) {
    .sidebar {
      position: fixed;
      inset: 0;
      width: 100%;
      z-index: 200;
      transform: translateX(-100%);
      transition: transform var(--duration-normal) var(--ease);
    }

    .sidebar.mobile-open {
      transform: translateX(0);
    }

    .sidebar.collapsed {
      width: 100%;
    }
  }

  /* Desktop: show collapse, hide close */
  .footer-btn.footer-mobile-close {
    display: none;
  }

  /* Mobile: hide collapse, show close */
  @media (max-width: 600px) {
    .footer-btn.footer-collapse {
      display: none;
    }
    .footer-btn.footer-mobile-close {
      display: flex;
    }
  }

  /* --- Top nav --- */

  .top-nav {
    border-bottom: 1px solid var(--color-border);
    padding: 2px 0;
    flex-shrink: 0;
  }

  .nav-link {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    margin: 2px 5px;
    padding: 5px calc(var(--sp-sm) - 5px);
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.2px;
    color: var(--color-text);
    text-decoration: none;
    outline: 1px solid transparent;
    transition:
      background var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease),
      outline-color var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }

  .nav-link:hover:not(.active) {
    background: var(--color-window);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.8),
      inset 0 -1px 0 rgba(0, 0, 0, 0.08),
      0 1px 2px rgba(0, 0, 0, 0.15);
    outline-color: var(--color-border);
  }

  .nav-link:active:not(.active) {
    background: var(--color-window);
    box-shadow: var(--shadow-inset);
    outline-color: var(--color-border);
  }

  .nav-link.active {
    background: linear-gradient(
      180deg,
      var(--color-accent-mid),
      var(--color-accent)
    );
    color: var(--color-accent-fg);
    font-weight: 700;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.35),
      inset 0 -1px 0 rgba(0, 0, 0, 0.15),
      0 1px 3px rgba(0, 0, 0, 0.3);
    outline-color: var(--color-accent);
  }

  .sidebar.collapsed .nav-label {
    display: none;
  }

  @media (max-width: 600px) {
    .nav-link {
      min-height: 44px;
      padding: var(--sp-sm) var(--sp-md);
      font-size: var(--text-base);
    }
  }

  /* --- Pinned + Recent --- */

  .lists {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-sm) 0 var(--sp-xs);
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
  }

  .jump {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    margin: 0 var(--sp-sm);
    padding: 4px var(--sp-xs);
    background: var(--color-window-inset);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-inset);
    color: var(--color-text-muted);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }

  .jump:hover {
    border-color: var(--color-accent-mid);
    color: var(--color-text);
  }

  .jump:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: 1px;
  }

  .jump-label {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .jump-key {
    font-family: var(--font-mono);
    font-size: 9px;
    padding: 1px 3px;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-window);
    white-space: nowrap;
  }

  .list-header {
    margin: 0;
    padding: 3px var(--sp-sm);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--color-section-bar-fg);
    background: var(--color-section-bar-bg);
    border-top: 1px solid var(--color-section-bar-border-top);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
  }

  .account-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .account-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-xs);
    padding: 3px var(--sp-sm);
    font-size: var(--text-xs);
    color: var(--color-text);
    text-decoration: none;
    transition: background var(--duration-fast) var(--ease);
  }

  .account-row:hover {
    background: var(--color-accent-light);
  }

  .account-row.active {
    background: var(--color-accent-light);
    box-shadow: inset 2px 0 0 var(--color-accent);
    font-weight: var(--weight-semibold);
  }

  @media (max-width: 600px) {
    .account-row {
      min-height: 44px;
      padding: var(--sp-xs) var(--sp-md);
      font-size: var(--text-sm);
    }
  }

  .account-name {
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .lists-empty {
    margin: 0;
    padding: 0 var(--sp-sm);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: 1.5;
  }

  .lists-empty a {
    color: var(--color-accent-mid);
  }

  .action-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-warning);
  }

  /* --- Footer --- */

  .sidebar-footer {
    border-top: 1px solid var(--color-border);
    padding: var(--sp-xs) 0;
    flex-shrink: 0;
    margin-top: auto;
  }

  .sidebar.collapsed .sidebar-footer {
    border-top: none;
  }

  .footer-btn {
    display: flex;
    align-items: center;
    align-self: stretch;
    gap: var(--sp-sm);
    margin: 2px 5px;
    padding: 5px calc(var(--sp-sm) - 5px);
    border-radius: 6px;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--color-text);
    text-decoration: none;
    text-align: left;
    background: none;
    border: none;
    outline: 1px solid transparent;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease),
      outline-color var(--duration-fast) var(--ease),
      color var(--duration-fast) var(--ease);
  }

  .footer-btn:hover {
    background: var(--color-window);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.8),
      inset 0 -1px 0 rgba(0, 0, 0, 0.08),
      0 1px 2px rgba(0, 0, 0, 0.15);
    outline-color: var(--color-border);
  }

  .footer-btn:active {
    background: var(--color-window);
    box-shadow: var(--shadow-inset);
    outline-color: var(--color-border);
  }

  .footer-settings .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* Collapsed: icon-only — gradient pill on hover, same as expanded active */
  .sidebar.collapsed .nav-link,
  .sidebar.collapsed .footer-btn {
    width: 28px;
    height: 28px;
    margin: 3px 10px;
    padding: 0;
    border-radius: 6px;
    justify-content: center;
    background: none;
    box-shadow: none;
    outline: 1px solid transparent;
  }

  .sidebar.collapsed .nav-link:hover:not(.active),
  .sidebar.collapsed .footer-btn:hover {
    background: var(--color-window);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.8),
      inset 0 -1px 0 rgba(0, 0, 0, 0.08),
      0 1px 2px rgba(0, 0, 0, 0.15);
    outline-color: var(--color-border);
  }

  .sidebar.collapsed .nav-link:active:not(.active),
  .sidebar.collapsed .footer-btn:active {
    background: var(--color-accent);
    color: var(--color-accent-fg);
    box-shadow: var(--shadow-inset);
    outline-color: var(--color-accent);
  }

  .sidebar.collapsed .nav-link.active {
    background: linear-gradient(
      180deg,
      var(--color-accent-mid),
      var(--color-accent)
    );
    color: var(--color-accent-fg);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.35),
      inset 0 -1px 0 rgba(0, 0, 0, 0.15),
      0 1px 3px rgba(0, 0, 0, 0.3);
    outline-color: var(--color-accent);
  }

  @media (max-width: 600px) {
    .footer-btn {
      min-height: 44px;
      padding: var(--sp-xs) var(--sp-md);
      font-size: var(--text-sm);
    }
  }
</style>
