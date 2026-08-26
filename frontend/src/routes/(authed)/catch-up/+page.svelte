<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import Card from '$lib/components/ui/Card.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import StartingLine from '$lib/components/catch-up/StartingLine.svelte'
  import CatchUpProgress from '$lib/components/catch-up/CatchUpProgress.svelte'
  import CatchUpAccountCard from '$lib/components/catch-up/CatchUpAccountCard.svelte'
  import CoverageStrip from '$lib/components/catch-up/CoverageStrip.svelte'
  import { proposeStartingLines, type StartingLineProposal } from '$lib/components/catch-up/bootstrap'
  import { currentSummary, displayName, donePanelCopy, groupAccounts } from '$lib/components/catch-up/hub'
  import {
    createCoverage,
    fetchCatchUp,
    updateCoverageConfig,
    type CatchUpAccount,
    type CatchUpPayload,
  } from '$lib/api'

  let payload = $state<CatchUpPayload | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let dormantOpen = $state(false)

  // Bootstrap owns the page while any account has never been asserted. Showing the queue
  // alongside it would mean showing accounts as maximally behind before the user has had the
  // chance to say where they actually stand.
  let proposals = $derived(payload ? proposeStartingLines(payload.accounts, payload.today) : [])
  let needsBootstrap = $derived(proposals.length > 0)

  let groups = $derived(groupAccounts(payload?.accounts ?? []))
  let allCurrent = $derived(
    payload !== null && payload.summary.tracked > 0 && groups.behind.length === 0,
  )

  async function load() {
    loading = true
    error = null
    try {
      payload = await fetchCatchUp()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not load your catch-up status'
    } finally {
      loading = false
    }
  }

  // Written one at a time rather than in a batch: there is no batch endpoint, and a partial
  // failure here is recoverable — whatever landed stays, and the remaining accounts simply
  // still need a starting line next time the page loads.
  async function acceptStartingLines(accepted: StartingLineProposal[]) {
    for (const proposal of accepted) {
      await createCoverage({
        accountId: proposal.accountId,
        fromDate: proposal.fromDate,
        throughDate: proposal.throughDate,
        source: proposal.source,
        note: 'starting line',
      })
    }
    await load()
  }

  // "Nothing happened here" covers the whole open window, which ends at the horizon rather
  // than at today — asserting past it would claim data the bank has not published.
  async function markEmpty(account: CatchUpAccount) {
    if (!account.gap) return
    await createCoverage({
      accountId: account.accountId,
      fromDate: account.gap.from,
      throughDate: account.gap.through,
      source: 'empty',
    })
    await load()
  }

  async function markThrough(account: CatchUpAccount, throughDate: string) {
    if (!account.gap) return
    await createCoverage({
      accountId: account.accountId,
      fromDate: account.gap.from,
      throughDate,
      source: 'manual',
    })
    await load()
  }

  async function untrack(account: CatchUpAccount) {
    await updateCoverageConfig(account.accountId, { tracked: false })
    await load()
  }

  // Story 7 turns this into a handoff carrying the account and date range. Until then it is
  // an ordinary link to the import flow.
  function startImport(_account: CatchUpAccount) {
    goto('/import')
  }

  onMount(load)
</script>

<svelte:head><title>Catch Up · have-fish</title></svelte:head>

<div class="page">
  <h1>Catch Up</h1>

  {#if loading}
    <p class="status">Loading…</p>
  {:else if error}
    <Card>
      <div class="pad"><p class="error" role="alert">{error}</p></div>
    </Card>
  {:else if !payload || payload.summary.tracked === 0}
    <Card>
      <div class="pad">
        <p class="status">
          No accounts to track yet. Asset and liability accounts show up here once you have
          some.
        </p>
      </div>
    </Card>
  {:else if needsBootstrap}
    <StartingLine {proposals} onaccept={acceptStartingLines} />
  {:else}
    <Card>
      <div class="pad">
        <CatchUpProgress
          current={payload.summary.progress.current}
          tracked={payload.summary.progress.tracked}
        />
      </div>
    </Card>

    {#if allCurrent}
      <!-- Nothing to do. One calm panel rather than a page of empty cards. -->
      {@const done = donePanelCopy(groups)}
      <Card>
        <div class="pad done">
          <p class="done-line">{done.headline}</p>
          <p class="status">{done.note}</p>
        </div>
      </Card>
    {:else}
      <div class="queue">
        {#each groups.behind as account (account.accountId)}
          <CatchUpAccountCard
            {account}
            onmarkEmpty={markEmpty}
            onmarkThrough={markThrough}
            onuntrack={untrack}
            onimport={startImport}
          />
        {/each}
      </div>
    {/if}

    {#if groups.current.length > 0 && !allCurrent}
      <Card>
        <div class="section-header">CURRENT</div>
        <div class="quiet-list">
          {#each groups.current as account (account.accountId)}
            <div class="quiet-row">
              <span class="quiet-name">{displayName(account)}</span>
              <span class="quiet-status">{currentSummary(account)}</span>
            </div>
          {/each}
        </div>
      </Card>
    {/if}

    {#if groups.dormant.length > 0}
      <div class="dormant">
        <button
          class="dormant-toggle"
          onclick={() => (dormantOpen = !dormantOpen)}
          aria-expanded={dormantOpen}
        >
          {dormantOpen ? '▾' : '▸'}
          {groups.dormant.length} quiet
          {groups.dormant.length === 1 ? 'account' : 'accounts'}
        </button>

        {#if dormantOpen}
          <div class="dormant-list">
            {#each groups.dormant as account (account.accountId)}
              <Card>
                <div class="dormant-head">
                  <span class="quiet-name">{displayName(account)}</span>
                  <span class="quiet-status">
                    {account.gap ? `${account.gap.days} days uncovered` : currentSummary(account)}
                  </span>
                </div>
                <div class="pad">
                  <CoverageStrip
                    from={account.strip.from}
                    to={account.strip.to}
                    intervals={account.strip.intervals}
                    horizon={account.horizon}
                    txnDates={account.strip.txnDates}
                    showLegend={false}
                  />
                  {#if account.gap}
                    <div class="dormant-actions">
                      <GradientButton size="sm" onclick={() => markEmpty(account)}>
                        Nothing happened here
                      </GradientButton>
                      <GradientButton size="sm" onclick={() => untrack(account)}>
                        Don't track this
                      </GradientButton>
                    </div>
                  {/if}
                </div>
              </Card>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    padding: var(--sp-lg);
    max-width: 900px;
  }

  h1 {
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .pad {
    padding: var(--sp-md);
  }

  .queue {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
  }

  .status {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .done {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .done-line {
    margin: 0;
    font-family: var(--font-serif);
    font-size: var(--text-lg);
    color: var(--color-text);
  }

  .error {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-warning);
  }

  .section-header {
    padding: 3px var(--sp-sm);
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
    border-radius: calc(var(--card-radius) - 1px) calc(var(--card-radius) - 1px) 0 0;
  }

  .quiet-list {
    display: flex;
    flex-direction: column;
  }

  .quiet-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-sm);
    padding: 5px var(--sp-md);
    font-size: var(--text-sm);
  }

  .quiet-row + .quiet-row {
    border-top: 1px solid var(--color-rule-soft);
  }

  .quiet-name {
    color: var(--color-text);
  }

  .quiet-status {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* Dormant accounts sit below a quiet divider, collapsed. They are ranked last, not hidden —
     a quiet account that wakes up has to be findable. */
  .dormant {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
    margin-top: var(--sp-sm);
    padding-top: var(--sp-sm);
    border-top: 1px solid var(--color-rule-soft);
  }

  .dormant-toggle {
    align-self: flex-start;
    padding: 2px 4px;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease);
  }

  .dormant-toggle:hover {
    color: var(--color-text);
  }

  .dormant-toggle:focus-visible {
    outline: 2px solid var(--color-accent-mid);
  }

  .dormant-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .dormant-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-sm);
    padding: 4px var(--sp-md);
    border-bottom: 1px solid var(--color-rule-soft);
  }

  .dormant-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-xs);
    margin-top: var(--sp-sm);
  }
</style>
