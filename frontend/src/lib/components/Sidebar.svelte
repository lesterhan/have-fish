<script lang="ts">
  import { afterNavigate } from '$app/navigation'
  import type { AccountBalance, UserSettings } from '$lib/api'
  import { formatCompact } from '$lib/currency'
  import CurrencyPill from '$lib/components/ui/CurrencyPill.svelte'
  import { theme } from '$lib/theme.svelte'
  import { tooltip } from '$lib/tooltip'
  import { settingsStore } from '$lib/settings.svelte'
  import { actionRequiredStore } from '$lib/actionRequired.svelte'
  import Icon from './ui/Icon.svelte'

  interface Props {
    accounts: AccountBalance[]
    settings: UserSettings
    email?: string
    mobileOpen?: boolean
    onMobileClose?: () => void
  }

  let {
    accounts,
    settings,
    email,
    mobileOpen = false,
    onMobileClose,
  }: Props = $props()

  afterNavigate(() => onMobileClose?.())

  let expanded = $state(true)
  let assetsOpen = $state(true)
  let liabilitiesOpen = $state(true)
  let equityOpen = $state(true)
  let hiddenOpen = $state(false)

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

  let assets = $derived(
    sortByDisplayName(
      accounts.filter(
        (a) =>
          !hiddenIds.has(a.id) &&
          a.path.startsWith(`${settings.defaultAssetsRootPath}:`),
      ),
      settings.defaultAssetsRootPath,
    ),
  )
  let liabilities = $derived(
    sortByDisplayName(
      accounts.filter(
        (a) =>
          !hiddenIds.has(a.id) &&
          a.path.startsWith(`${settings.defaultLiabilitiesRootPath}:`),
      ),
      settings.defaultLiabilitiesRootPath,
    ),
  )
  let equity = $derived(
    sortByDisplayName(
      accounts.filter(
        (a) =>
          !hiddenIds.has(a.id) &&
          a.path.startsWith(`${settings.defaultEquityRootPath}:`),
      ),
      settings.defaultEquityRootPath,
    ),
  )
  let hiddenAccounts = $derived(
    sortByDisplayName(
      accounts.filter((a) => hiddenIds.has(a.id)),
      '',
    ),
  )

  function shortName(path: string, root: string): string {
    return path.startsWith(`${root}:`) ? path.slice(root.length + 1) : path
  }

  function displayName(acct: AccountBalance, root: string): string {
    return acct.name ?? shortName(acct.path, root)
  }

  function sortByDisplayName(
    accts: AccountBalance[],
    root: string,
  ): AccountBalance[] {
    return [...accts].sort((a, b) =>
      displayName(a, root).localeCompare(displayName(b, root)),
    )
  }
</script>

<aside
  class="sidebar"
  class:collapsed={!expanded}
  class:mobile-open={mobileOpen}
>
  <div class="sidebar-inner">
    <!-- Top nav — always rendered so icons show in collapsed state -->
    <div class="top-nav">
      <a href="/spending" class="nav-link" use:tooltip={'Spending'}>
        <Icon name="spending" size={16} />
        <span class="nav-label">Spending</span>
      </a>
      <a href="/import" class="nav-link" use:tooltip={'Import + Export'}>
        <Icon name="import-export" size={16} />
        <span class="nav-label">Import + Export</span>
      </a>
      <a href="/transactions" class="nav-link" use:tooltip={'Transactions'}>
        <Icon name="transactions" size={16} />
        <span class="nav-label">Transactions</span>
      </a>
      <a href="/assets" class="nav-link" use:tooltip={'Accounts'}>
        <Icon name="accounts" size={16} />
        <span class="nav-label">Accounts</span>
      </a>
      <a href="/fish-pie" class="nav-link" use:tooltip={'Fish Pie'}>
        <Icon name="pie" size={16} />
        <span class="nav-label">Fish Pie</span>
      </a>
      <!--
        <a href="/dashboard" class="nav-link nav-link-wip" use:tooltip={'Dashboard [WIP]'}>
          <Icon name="dashboard" size={16} />
          <span class="nav-label">Dashboard [WIP]</span>
        </a>
        -->
    </div>

    {#if expanded || mobileOpen}
      <!-- Account groups -->
      <div class="groups">
        <section class="group">
          <button
            class="group-header"
            onclick={() => (assetsOpen = !assetsOpen)}
          >
            <img
              src="/icons/chevron.svg"
              alt=""
              aria-hidden="true"
              width="12"
              height="12"
              class="svg-icon group-chevron"
              class:open={assetsOpen}
            />
            Assets
          </button>
          {#if assetsOpen}
            <ul class="account-list">
              {#each assets as acct}
                <li>
                  <a href="/account/{acct.id}" class="account-row">
                    <span class="account-name"
                      >{acct.name ??
                        shortName(
                          acct.path,
                          settings.defaultAssetsRootPath,
                        )}</span
                    >
                    {#if actionRequiredIds.has(acct.id)}<span
                        class="action-dot"
                        aria-label="Action required"
                      ></span>{/if}
                    <span class="account-balances">
                      {#if acct.balances.length === 0}
                        <span class="account-balance muted">—</span>
                      {:else}
                        {#each acct.balances as b}
                          <span class="account-balance">
                            <CurrencyPill code={b.currency} size="xs" />
                            {formatCompact(b.amount)}
                          </span>
                        {/each}
                      {/if}
                    </span>
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="group">
          <button
            class="group-header"
            onclick={() => (liabilitiesOpen = !liabilitiesOpen)}
          >
            <img
              src="/icons/chevron.svg"
              alt=""
              aria-hidden="true"
              width="12"
              height="12"
              class="svg-icon group-chevron"
              class:open={liabilitiesOpen}
            />
            Liabilities
          </button>
          {#if liabilitiesOpen}
            <ul class="account-list">
              {#each liabilities as acct}
                <li>
                  <a href="/account/{acct.id}" class="account-row">
                    <span class="account-name"
                      >{acct.name ??
                        shortName(
                          acct.path,
                          settings.defaultLiabilitiesRootPath,
                        )}</span
                    >
                    {#if actionRequiredIds.has(acct.id)}<span
                        class="action-dot"
                        aria-label="Action required"
                      ></span>{/if}
                    <span class="account-balances">
                      {#if acct.balances.length === 0}
                        <span class="account-balance muted">—</span>
                      {:else}
                        {#each acct.balances as b}
                          <span class="account-balance">
                            <CurrencyPill code={b.currency} size="xs" />
                            {formatCompact(b.amount)}
                          </span>
                        {/each}
                      {/if}
                    </span>
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="group">
          <button
            class="group-header"
            onclick={() => (equityOpen = !equityOpen)}
          >
            <img
              src="/icons/chevron.svg"
              alt=""
              aria-hidden="true"
              width="12"
              height="12"
              class="svg-icon group-chevron"
              class:open={equityOpen}
            />
            Equity
          </button>
          {#if equityOpen}
            <ul class="account-list">
              {#each equity as acct}
                <li>
                  <a href="/account/{acct.id}" class="account-row">
                    <span class="account-name"
                      >{acct.name ??
                        shortName(
                          acct.path,
                          settings.defaultEquityRootPath,
                        )}</span
                    >
                    {#if actionRequiredIds.has(acct.id)}<span
                        class="action-dot"
                        aria-label="Action required"
                      ></span>{/if}
                    <span class="account-balances">
                      {#if acct.balances.length === 0}
                        <span class="account-balance muted">—</span>
                      {:else}
                        {#each acct.balances as b}
                          <span class="account-balance">
                            <CurrencyPill code={b.currency} size="xs" />
                            {formatCompact(b.amount)}
                          </span>
                        {/each}
                      {/if}
                    </span>
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        {#if hiddenAccounts.length > 0}
          <section class="group group-hidden">
            <button
              class="group-header"
              onclick={() => (hiddenOpen = !hiddenOpen)}
            >
              <img
                src="/icons/chevron.svg"
                alt=""
                aria-hidden="true"
                width="12"
                height="12"
                class="svg-icon group-chevron"
                class:open={hiddenOpen}
              />
              Hidden
            </button>
            {#if hiddenOpen}
              <ul class="account-list">
                {#each hiddenAccounts as acct}
                  <li>
                    <a
                      href="/account/{acct.id}"
                      class="account-row account-row-hidden"
                    >
                      <span class="account-name">{acct.name ?? acct.path}</span>
                    </a>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
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

<style>
  /* --- Sidebar shell --- */

  .sidebar {
    width: 200px;
    flex-shrink: 0;
    background: var(--color-window);
    box-shadow: inset -1px 0 0 var(--color-bevel-dark);
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

  /* --- SVG icons (loaded via <img>, no currentColor) --- */

  /* invert to white in dark mode */
  :global([data-theme='dark']) .svg-icon {
    filter: invert(1);
  }

  /* --- Top nav --- */

  .top-nav {
    border-bottom: 1px solid var(--color-border);
    padding: 2px 0;
    flex-shrink: 0;
  }

  /* Expanded: left-border accent style — subtle, not busy */
  .nav-link {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 6px var(--sp-sm);
    font-size: var(--text-sm);
    color: var(--color-text);
    text-decoration: none;
    border-left: 2px solid transparent;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }

  .nav-link:hover {
    background: var(--color-accent-light);
    border-left-color: var(--color-accent-mid);
  }

  .nav-link:active {
    background: var(--color-accent-mid);
    color: var(--color-text-on-dark);
    border-left-color: var(--color-accent);
  }

  /* Collapsed: icon-only toolbar buttons — Photoshop style */
  .sidebar.collapsed .nav-link {
    width: 28px;
    height: 28px;
    margin: var(--sp-xs) 10px;
    padding: 0;
    justify-content: center;
    border-left: none;
    box-shadow: var(--shadow-raised);
    background: var(--color-window);
    transition:
      box-shadow var(--duration-fast) var(--ease),
      background var(--duration-fast) var(--ease);
  }

  .sidebar.collapsed .nav-link:hover {
    background: var(--color-accent-light);
    border-left: none;
  }

  .sidebar.collapsed .nav-link:active {
    box-shadow: var(--shadow-sunken);
    background: var(--color-window);
    color: var(--color-text);
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

  /* --- Account groups --- */

  .groups {
    flex: 1;
    overflow-y: auto;
    padding: 0 0 var(--sp-xs);
  }

  .group {
    margin-bottom: var(--sp-xs);
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: var(--sp-xs) var(--sp-sm) 2px;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    font-family: var(--font-sans);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease);
  }

  .group-header:hover {
    color: var(--color-accent-mid);
  }

  .group-chevron {
    flex-shrink: 0;
    transform-origin: center center;
    transition: transform var(--duration-fast) var(--ease);
  }

  .group-chevron.open {
    transform: rotate(90deg);
  }

  @media (max-width: 600px) {
    .group-header {
      padding: var(--sp-sm) var(--sp-md) var(--sp-xs);
    }
  }

  .account-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .account-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-xs);
    padding: 2px var(--sp-sm);
    font-size: var(--text-xs);
    color: var(--color-text);
    text-decoration: none;
    transition: background var(--duration-fast) var(--ease);
  }

  .account-row:hover {
    background: var(--color-accent-light);
  }

  @media (max-width: 600px) {
    .account-row {
      min-height: 44px;
      align-items: center;
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
    padding-top: 2px;
  }

  @media (max-width: 600px) {
    .account-name {
      padding-top: 0;
    }
  }

  .account-balances {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
  }

  .account-balance {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .account-balance.muted {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .group-hidden .group-header {
    color: var(--color-text-disabled);
  }

  .account-row-hidden .account-name {
    color: var(--color-text-disabled);
    font-style: italic;
  }

  .action-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-warning);
    margin-top: 4px;
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
    gap: var(--sp-sm);
    width: 100%;
    padding: 6px var(--sp-sm);
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    color: var(--color-text);
    text-decoration: none;
    text-align: left;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease),
      border-color var(--duration-fast) var(--ease);
  }

  .footer-btn:hover {
    background: var(--color-accent-light);
    border-left-color: var(--color-accent-mid);
  }

  .footer-settings .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* Collapsed: icon-only toolbar buttons */
  .sidebar.collapsed .footer-btn {
    width: 28px;
    height: 28px;
    margin: var(--sp-xs) 10px;
    padding: 0;
    justify-content: center;
    border-left: none;
    box-shadow: var(--shadow-raised);
    background: var(--color-window);
    transition:
      box-shadow var(--duration-fast) var(--ease),
      background var(--duration-fast) var(--ease);
  }

  .sidebar.collapsed .footer-btn:hover {
    background: var(--color-accent-light);
    border-left: none;
  }

  .sidebar.collapsed .footer-btn:active {
    box-shadow: var(--shadow-sunken);
    background: var(--color-window);
  }

  @media (max-width: 600px) {
    .footer-btn {
      min-height: 44px;
      padding: var(--sp-xs) var(--sp-md);
      font-size: var(--text-sm);
    }
  }
</style>
