<script lang="ts">
  import Card from '$lib/components/ui/Card.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import CoverageStrip from './CoverageStrip.svelte'
  import {
    displayName,
    emptyActionLabel,
    enteredInGapNote,
    gapSummary,
  } from './hub'
  import type { CatchUpAccount } from '$lib/api'

  interface Props {
    account: CatchUpAccount
    // Each returns once the write has landed; the page reloads the payload after.
    onmarkEmpty: (account: CatchUpAccount) => Promise<void>
    onmarkThrough: (account: CatchUpAccount, throughDate: string) => Promise<void>
    onuntrack: (account: CatchUpAccount) => Promise<void>
    onimport: (account: CatchUpAccount) => void
  }

  let { account, onmarkEmpty, onmarkThrough, onuntrack, onimport }: Props = $props()

  let busy = $state(false)
  let error = $state<string | null>(null)
  let markingThrough = $state(false)
  let throughDate = $state('')

  // Only ever a date inside the open window: covering past the horizon would assert data the
  // bank has not published, and covering before the gap start asserts nothing new.
  let throughValid = $derived(
    account.gap !== null &&
      /^\d{4}-\d{2}-\d{2}$/.test(throughDate) &&
      throughDate >= account.gap.from &&
      throughDate <= account.gap.through,
  )

  async function run(action: () => Promise<void>) {
    if (busy) return
    busy = true
    error = null
    try {
      await action()
    } catch (e) {
      error = e instanceof Error ? e.message : 'That did not save'
    } finally {
      busy = false
    }
  }

  function openMarkThrough() {
    throughDate = account.gap?.through ?? ''
    markingThrough = true
  }
</script>

<Card>
  <div class="head">
    <span class="name">{displayName(account)}</span>
    <span class="summary">{gapSummary(account) ?? ''}</span>
  </div>

  <div class="body">
    <CoverageStrip
      from={account.strip.from}
      to={account.strip.to}
      intervals={account.strip.intervals}
      horizon={account.horizon}
      txnDates={account.strip.txnDates}
      showLegend={false}
    />

    <div class="facts">
      {#if account.coveredThrough}
        <span>Covered through {account.coveredThrough}</span>
      {/if}
      {#if account.horizonReason === 'statement'}
        <span>Statement data available through {account.horizon}</span>
      {/if}
      {#if enteredInGapNote(account)}
        <span class="entered">{enteredInGapNote(account)}</span>
      {/if}
    </div>

    {#if markingThrough}
      <div class="mark-through">
        <label class="field">
          <span class="field-label">Complete through</span>
          <input
            type="date"
            bind:value={throughDate}
            min={account.gap?.from}
            max={account.gap?.through}
            aria-label="Mark {displayName(account)} complete through"
          />
        </label>
        <GradientButton
          disabled={!throughValid || busy}
          onclick={() => run(async () => {
            await onmarkThrough(account, throughDate)
            markingThrough = false
          })}
        >
          Save
        </GradientButton>
        <GradientButton onclick={() => (markingThrough = false)}>Cancel</GradientButton>
      </div>
    {:else}
      <div class="actions">
        <GradientButton onclick={() => onimport(account)} disabled={busy}>Import</GradientButton>
        <GradientButton
          disabled={busy || !account.gap}
          tooltip={emptyActionLabel(account) ?? ''}
          onclick={() => run(() => onmarkEmpty(account))}
        >
          Nothing happened here
        </GradientButton>
        <GradientButton disabled={busy} onclick={openMarkThrough}>Mark complete through…</GradientButton>
        <GradientButton disabled={busy} onclick={() => run(() => onuntrack(account))}>
          Don't track this
        </GradientButton>
      </div>
    {/if}

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
  </div>
</Card>

<style>
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-sm);
    flex-wrap: wrap;
    padding: 3px var(--sp-sm);
    background: var(--color-section-bar-bg);
    color: var(--color-section-bar-fg);
    border-bottom: 1px solid var(--color-section-bar-border-bottom);
    border-radius: calc(var(--card-radius) - 1px) calc(var(--card-radius) - 1px) 0 0;
  }

  .name {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .summary {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    opacity: 0.85;
    font-variant-numeric: tabular-nums;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-md) var(--sp-md);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-sm);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* The mixed state deserves its own weight — a month holding three phone-entered splits
     looks finished in the transaction list when it is not. */
  .entered {
    color: var(--color-text);
  }

  .actions,
  .mark-through {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--sp-xs);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .field-label {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  input[type='date'] {
    height: 24px;
    padding: 0 6px;
    background: var(--color-window-inset);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-inset);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  input[type='date']:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  .error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-warning);
  }
</style>
