<script lang="ts">
  import Card from '$lib/components/ui/Card.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import Checkbox from '$lib/components/ui/Checkbox.svelte'
  import { describeProposal, isValidProposal, type StartingLineProposal } from './bootstrap'

  interface Props {
    proposals: StartingLineProposal[]
    // Resolves once every accepted row is written. The page reloads the payload after.
    onaccept: (accepted: StartingLineProposal[]) => Promise<void>
  }

  let { proposals, onaccept }: Props = $props()

  // Only the user's corrections are stored, not a copy of the proposals — so a reloaded
  // payload flows straight through instead of being shadowed by a stale snapshot.
  let overrides = $state<Record<string, Partial<{ fromDate: string; throughDate: string }>>>({})
  let skipped = $state<Set<string>>(new Set())
  let saving = $state(false)
  let error = $state<string | null>(null)

  function datesFor(proposal: StartingLineProposal) {
    const override = overrides[proposal.accountId] ?? {}
    return {
      fromDate: override.fromDate ?? proposal.fromDate,
      throughDate: override.throughDate ?? proposal.throughDate,
    }
  }

  function setDate(accountId: string, field: 'fromDate' | 'throughDate', value: string) {
    overrides = { ...overrides, [accountId]: { ...overrides[accountId], [field]: value } }
  }

  let included = $derived(proposals.filter((p) => !skipped.has(p.accountId)))
  let invalid = $derived(included.filter((p) => !isValidProposal(datesFor(p))))
  let canAccept = $derived(included.length > 0 && invalid.length === 0 && !saving)

  function toggleSkip(accountId: string) {
    const next = new Set(skipped)
    if (next.has(accountId)) next.delete(accountId)
    else next.add(accountId)
    skipped = next
  }

  async function accept() {
    if (!canAccept) return
    saving = true
    error = null
    try {
      await onaccept(included.map((p) => ({ ...p, ...datesFor(p) })))
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save your starting line'
    } finally {
      saving = false
    }
  }
</script>

<Card>
  <div class="section-header">SET YOUR STARTING LINE</div>
  <div class="section-body">
    <p class="lede">
      The coach needs to know how far along each account already is. Everything you have
      entered so far is assumed complete — accept this and the coach only ever asks about
      what comes after.
    </p>

    <div class="rows">
      {#each proposals as proposal (proposal.accountId)}
        {@const isSkipped = skipped.has(proposal.accountId)}
        {@const dates = datesFor(proposal)}
        {@const rowInvalid = !isSkipped && !isValidProposal(dates)}
        <div class="row" class:skipped={isSkipped}>
          <div class="row-head">
            <Checkbox
              checked={!isSkipped}
              onchange={() => toggleSkip(proposal.accountId)}
              label={proposal.name ?? proposal.path}
            />
          </div>

          <div class="row-dates">
            <label class="field">
              <span class="field-label">From</span>
              <input
                type="date"
                value={dates.fromDate}
                oninput={(e) => setDate(proposal.accountId, 'fromDate', e.currentTarget.value)}
                disabled={isSkipped}
                aria-label="Covered from, {proposal.path}"
              />
            </label>
            <label class="field">
              <span class="field-label">Through</span>
              <input
                type="date"
                value={dates.throughDate}
                oninput={(e) => setDate(proposal.accountId, 'throughDate', e.currentTarget.value)}
                disabled={isSkipped}
                aria-label="Covered through, {proposal.path}"
              />
            </label>
          </div>

          <p class="row-note" class:invalid={rowInvalid}>
            {#if isSkipped}
              Skipped — the coach will keep asking about this one
            {:else if rowInvalid}
              The start date has to come before the end date
            {:else}
              {describeProposal({ ...proposal, ...dates })}
            {/if}
          </p>
        </div>
      {/each}
    </div>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <div class="actions">
      <GradientButton size="lg" onclick={accept} disabled={!canAccept}>
        {saving ? 'Saving…' : `Accept all (${included.length})`}
      </GradientButton>
      <span class="hint">You can undo any of this later from the account page.</span>
    </div>
  </div>
</Card>

<style>
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

  .section-body {
    padding: var(--sp-md);
  }

  .lede {
    margin: 0 0 var(--sp-md);
    max-width: 60ch;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    line-height: 1.5;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .row {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) auto;
    grid-template-areas:
      'head dates'
      'note note';
    gap: var(--sp-xs) var(--sp-md);
    align-items: center;
    padding: var(--sp-sm);
    background: var(--color-window-raised);
    border: 1px solid var(--color-rule-soft);
    border-radius: var(--radius-lg);
    transition: opacity var(--duration-fast) var(--ease);
  }

  .row.skipped {
    opacity: 0.5;
  }

  .row-head {
    grid-area: head;
    min-width: 0;
  }

  .row-dates {
    grid-area: dates;
    display: flex;
    gap: var(--sp-sm);
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
    transition: border-color var(--duration-fast) var(--ease);
  }

  input[type='date']:focus-visible {
    outline: 2px solid var(--color-accent-mid);
    outline-offset: -1px;
  }

  input[type='date']:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .row-note {
    grid-area: note;
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .row-note.invalid {
    color: var(--color-warning);
  }

  .error {
    margin: var(--sp-md) 0 0;
    font-size: var(--text-sm);
    color: var(--color-warning);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    margin-top: var(--sp-md);
    padding-top: var(--sp-md);
    border-top: 1px solid var(--color-rule-soft);
    flex-wrap: wrap;
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  @media (max-width: 640px) {
    .row {
      grid-template-columns: 1fr;
      grid-template-areas: 'head' 'dates' 'note';
      align-items: start;
    }
  }
</style>
