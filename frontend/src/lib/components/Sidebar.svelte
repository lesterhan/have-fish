<script lang="ts">
  import MoneyDisplay from "./ui/MoneyDisplay.svelte";
  import type { AccountBalance, UserSettings } from "$lib/api";
  import { theme } from "$lib/theme.svelte";
  import { tooltip } from "$lib/tooltip";
  import { settingsStore } from "$lib/settings.svelte";

  interface Props {
    accounts: AccountBalance[];
    settings: UserSettings;
    email?: string;
    mobileOpen?: boolean;
    onMobileClose?: () => void;
  }

  let {
    accounts,
    settings,
    email,
    mobileOpen = false,
    onMobileClose,
  }: Props = $props();

  let expanded = $state(true);
  let assetsOpen = $state(true);
  let liabilitiesOpen = $state(true);
  let equityOpen = $state(true);
  let hiddenOpen = $state(false);

  let hiddenIds = $derived(
    new Set(settingsStore.value?.preferences.hiddenAccountIds ?? []),
  );

  let assets = $derived(
    accounts.filter(
      (a) =>
        !hiddenIds.has(a.id) &&
        a.path.startsWith(`${settings.defaultAssetsRootPath}:`),
    ),
  );
  let liabilities = $derived(
    accounts.filter(
      (a) =>
        !hiddenIds.has(a.id) &&
        a.path.startsWith(`${settings.defaultLiabilitiesRootPath}:`),
    ),
  );
  let equity = $derived(
    accounts.filter(
      (a) =>
        !hiddenIds.has(a.id) &&
        a.path.startsWith(`${settings.defaultEquityRootPath}:`),
    ),
  );
  let hiddenAccounts = $derived(accounts.filter((a) => hiddenIds.has(a.id)));

  function shortName(path: string, root: string): string {
    return path.startsWith(`${root}:`) ? path.slice(root.length + 1) : path;
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
      <a href="/dashboard" class="nav-link" use:tooltip={"Dashboard"}>
        <img
          src="/icons/dashboard.svg"
          class="svg-icon nav-icon"
          alt=""
          aria-hidden="true"
          width="16"
          height="16"
        />
        <span class="nav-label">Dashboard</span>
      </a>
      <a href="/transactions" class="nav-link" use:tooltip={"Transactions"}>
        <img
          src="/icons/transactions.svg"
          class="svg-icon nav-icon"
          alt=""
          aria-hidden="true"
          width="16"
          height="16"
        />
        <span class="nav-label">Transactions</span>
      </a>
      <a href="/assets" class="nav-link" use:tooltip={"Accounts"}>
        <img
          src="/icons/accounts.svg"
          class="svg-icon nav-icon"
          alt=""
          aria-hidden="true"
          width="16"
          height="16"
        />
        <span class="nav-label">Accounts</span>
      </a>
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
                    <span class="account-balances">
                      {#if acct.balances.length === 0}
                        <span class="account-balance muted">—</span>
                      {:else}
                        {#each acct.balances as b}
                          <MoneyDisplay
                            amount={b.amount}
                            currency={b.currency}
                          />
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
                    <span class="account-balances">
                      {#if acct.balances.length === 0}
                        <span class="account-balance muted">—</span>
                      {:else}
                        {#each acct.balances as b}
                          <MoneyDisplay
                            amount={b.amount}
                            currency={b.currency}
                          />
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
                    <span class="account-balances">
                      {#if acct.balances.length === 0}
                        <span class="account-balance muted">—</span>
                      {:else}
                        {#each acct.balances as b}
                          <MoneyDisplay
                            amount={b.amount}
                            currency={b.currency}
                          />
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
      <button
        class="footer-btn footer-collapse"
        onclick={() => (expanded = !expanded)}
        aria-label={expanded ? "Compress sidebar" : "Expand sidebar"}
        use:tooltip={"Expand"}
      >
        {#if expanded}
          <img
            src="/icons/collapse-sidebar.svg"
            alt=""
            aria-hidden="true"
            width="16"
            height="16"
            class="svg-icon nav-icon"
          />
          <span class="nav-label">Compress sidebar</span>
        {:else}
          <img
            src="/icons/menu.svg"
            alt=""
            aria-hidden="true"
            width="16"
            height="16"
            class="svg-icon nav-icon"
          />
        {/if}
      </button>
      <button
        class="footer-btn"
        onclick={() => theme.toggle()}
        use:tooltip={theme.dark ? "Light Theme" : "Dark Theme"}
      >
        <img
          src={theme.dark ? "/icons/sun.svg" : "/icons/moon.svg"}
          alt=""
          aria-hidden="true"
          width="16"
          height="16"
          class="svg-icon nav-icon"
        />
        <span class="nav-label"
          >{theme.dark ? "Light Theme" : "Dark Theme"}</span
        >
      </button>
      {#if email}
        <a
          href="/settings"
          class="footer-btn footer-settings"
          use:tooltip={"Settings"}
        >
          <img
            src="/icons/user.svg"
            alt=""
            aria-hidden="true"
            width="16"
            height="16"
            class="svg-icon nav-icon"
          />
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

  /* Hide the collapse button on mobile — the hamburger in the titlebar handles that */
  @media (max-width: 600px) {
    .footer-collapse {
      display: none;
    }
  }

  /* --- SVG icons (loaded via <img>, no currentColor) --- */

  /* invert to white in dark mode */
  :global([data-theme="dark"]) .svg-icon {
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

  .nav-icon {
    flex-shrink: 0;
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

  .account-balances :global(.money) {
    flex-direction: row;
    gap: 3px;
    align-items: baseline;
  }

  .account-balances :global(.amount) {
    font-size: var(--text-xs);
  }
  .account-balances :global(.currency) {
    font-size: 10px;
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
