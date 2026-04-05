<script lang="ts">
  import MoneyDisplay from './MoneyDisplay.svelte'
  import type { AccountBalance, UserSettings } from '$lib/api'

  interface Props {
    accounts: AccountBalance[]
    settings: UserSettings
  }

  let { accounts, settings }: Props = $props()

  let expanded = $state(true)

  // Group accounts by root path prefix from settings
  let assets = $derived(
    accounts.filter(a => a.path.startsWith(`${settings.defaultAssetsRootPath}:`))
  )
  let liabilities = $derived(
    accounts.filter(a => a.path.startsWith(`${settings.defaultLiabilitiesRootPath}:`))
  )
  let equity = $derived(
    accounts.filter(a => a.path.startsWith(`${settings.defaultEquityRootPath}:`))
  )

  // Strip the root prefix for display — show only the leaf path
  function shortName(path: string, root: string): string {
    return path.startsWith(`${root}:`) ? path.slice(root.length + 1) : path
  }
</script>

<aside class="sidebar" class:collapsed={!expanded}>
  <div class="sidebar-inner">

    <!-- Toggle button — always visible in the collapsed strip -->
    <button
      class="toggle-btn"
      onclick={() => (expanded = !expanded)}
      aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
      title={expanded ? 'Collapse' : 'Expand'}
    >
      ☰
    </button>

    {#if expanded}
      <!-- Account groups -->
      <div class="groups">
        <section class="group">
          <a href="/assets" class="group-header">Assets</a>
          <ul class="account-list">
            {#each assets as acct}
              <li class="account-row">
                <span class="account-name">{shortName(acct.path, settings.defaultAssetsRootPath)}</span>
                <span class="account-balances">
                  {#if acct.balances.length === 0}
                    <span class="account-balance muted">—</span>
                  {:else}
                    {#each acct.balances as b}
                      <MoneyDisplay amount={b.amount} currency={b.currency} />
                    {/each}
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        </section>

        <section class="group">
          <a href="/assets" class="group-header">Liabilities</a>
          <ul class="account-list">
            {#each liabilities as acct}
              <li class="account-row">
                <span class="account-name">{shortName(acct.path, settings.defaultLiabilitiesRootPath)}</span>
                <span class="account-balances">
                  {#if acct.balances.length === 0}
                    <span class="account-balance muted">—</span>
                  {:else}
                    {#each acct.balances as b}
                      <MoneyDisplay amount={b.amount} currency={b.currency} />
                    {/each}
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        </section>

        <section class="group">
          <a href="/assets" class="group-header">Equity</a>
          <ul class="account-list">
            {#each equity as acct}
              <li class="account-row">
                <span class="account-name">{shortName(acct.path, settings.defaultEquityRootPath)}</span>
                <span class="account-balances">
                  {#if acct.balances.length === 0}
                    <span class="account-balance muted">—</span>
                  {:else}
                    {#each acct.balances as b}
                      <MoneyDisplay amount={b.amount} currency={b.currency} />
                    {/each}
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        </section>
      </div>

      <!-- Nav links -->
      <nav class="sidebar-nav">
        <a href="/transactions" class="nav-link">Transactions</a>
        <a href="/import" class="nav-link">Import</a>
      </nav>
    {/if}

  </div>
</aside>

<style>
  .sidebar {
    width: 200px;
    flex-shrink: 0;
    background: var(--color-window);
    /* sunken right edge separates sidebar from content pane */
    box-shadow: inset -2px 0 0 var(--color-bevel-dark), inset -3px 0 0 var(--color-bevel-shadow);
    display: flex;
    flex-direction: column;
    transition: width var(--duration-normal) var(--ease);
    overflow: hidden;
  }

  .sidebar.collapsed {
    width: 36px;
  }

  .sidebar-inner {
    display: flex;
    flex-direction: column;
    height: 100%;
    /* prevent content from wrapping during collapse transition */
    min-width: 200px;
  }

  /* --- Toggle button --- */

  .toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    /* explicit left margin so the button stays visible in the 36px collapsed strip */
    margin: var(--sp-xs) 0 var(--sp-xs) 4px;
    flex-shrink: 0;

    background: var(--color-window);
    border: none;
    box-shadow: var(--shadow-raised);
    font-size: var(--text-sm);
    font-family: var(--font-sans);
    color: var(--color-text);
    cursor: pointer;

    transition:
      box-shadow var(--duration-fast) var(--ease),
      background var(--duration-fast) var(--ease);
  }

  .toggle-btn:hover {
    background: var(--color-accent-light);
  }

  .toggle-btn:active {
    box-shadow: var(--shadow-sunken);
  }

  .toggle-btn:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -2px;
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
    display: block;
    padding: var(--sp-xs) var(--sp-sm) 2px;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
    text-decoration: none;
    transition: color var(--duration-fast) var(--ease);
  }

  .group-header:hover {
    color: var(--color-accent-mid);
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
    cursor: default;
    transition: background var(--duration-fast) var(--ease);
  }

  .account-row:hover {
    background: var(--color-accent-light);
  }

  .account-name {
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
    /* vertically align with the first balance line */
    padding-top: 2px;
  }

  .account-balances {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
  }

  /* Override MoneyDisplay sizing for the compact sidebar context */
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

  /* --- Nav links --- */

  .sidebar-nav {
    border-top: 1px solid var(--color-border);
    padding: var(--sp-xs) 0;
    flex-shrink: 0;
  }

  .nav-link {
    display: block;
    padding: 4px var(--sp-sm);
    font-size: var(--text-sm);
    color: var(--color-text);
    text-decoration: none;
    transition: background var(--duration-fast) var(--ease);
  }

  .nav-link:hover {
    background: var(--color-accent-light);
    color: var(--color-accent-mid);
  }

  .nav-link:active {
    background: var(--color-accent-mid);
    color: var(--color-text-on-dark);
  }
</style>
