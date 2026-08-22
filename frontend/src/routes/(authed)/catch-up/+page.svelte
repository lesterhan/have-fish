<script lang="ts">
  import { onMount } from 'svelte'
  import Card from '$lib/components/ui/Card.svelte'
  import StartingLine from '$lib/components/catch-up/StartingLine.svelte'
  import { proposeStartingLines, type StartingLineProposal } from '$lib/components/catch-up/bootstrap'
  import { createCoverage, fetchCatchUp, type CatchUpPayload } from '$lib/api'

  let payload = $state<CatchUpPayload | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)

  // Bootstrap owns the page while any account has never been asserted. Showing the queue
  // alongside it would mean showing accounts as maximally behind before the user has had the
  // chance to say where they actually stand.
  let proposals = $derived(
    payload ? proposeStartingLines(payload.accounts, payload.today) : [],
  )
  let needsBootstrap = $derived(proposals.length > 0)

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

  onMount(load)
</script>

<svelte:head><title>Catch Up · have-fish</title></svelte:head>

<div class="page">
  <h1>Catch Up</h1>

  {#if loading}
    <p class="status">Loading…</p>
  {:else if error}
    <Card>
      <div class="section-body">
        <p class="error" role="alert">{error}</p>
      </div>
    </Card>
  {:else if !payload || payload.summary.tracked === 0}
    <Card>
      <div class="section-body">
        <p class="status">
          No accounts to track yet. Asset and liability accounts show up here once you have
          some.
        </p>
      </div>
    </Card>
  {:else if needsBootstrap}
    <StartingLine {proposals} onaccept={acceptStartingLines} />
  {:else}
    <!-- The full hub — per-account cards, actions and the focus queue — lands in a later
         story. Until then this states where things stand rather than showing a stub. -->
    <Card>
      <div class="section-body">
        <p class="progress-line">
          {payload.summary.progress.current} of {payload.summary.progress.tracked} accounts
          are current.
        </p>
        {#if payload.summary.accountsToCatchUp > 0}
          <p class="status">
            {payload.summary.accountsToCatchUp}
            {payload.summary.accountsToCatchUp === 1 ? 'account needs' : 'accounts need'}
            catching up.
          </p>
        {:else}
          <p class="status">Ledger current.</p>
        {/if}
      </div>
    </Card>
  {/if}
</div>

<style>
  .page {
    padding: var(--sp-lg);
    max-width: 900px;
  }

  h1 {
    margin: 0 0 var(--sp-md);
    font-family: var(--font-serif);
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }

  .section-body {
    padding: var(--sp-md);
  }

  .status {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .progress-line {
    margin: 0 0 var(--sp-xs);
    font-size: var(--text-base);
    color: var(--color-text);
  }

  .error {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-warning);
  }
</style>
