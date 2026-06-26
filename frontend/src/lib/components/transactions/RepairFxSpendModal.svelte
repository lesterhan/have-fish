<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte'
  import GradientButton from '$lib/components/ui/GradientButton.svelte'
  import { healFxSpend, type MalformedFxSpend } from '$lib/api'

  interface Props {
    open: boolean
    candidates: MalformedFxSpend[]
    conversionAccountConfigured: boolean
    onhealed?: (transactionId: string) => void
  }

  let {
    open = $bindable(),
    candidates,
    conversionAccountConfigured,
    onhealed,
  }: Props = $props()

  // Per-transaction in-flight + error state, keyed by transaction id.
  let healing = $state<Record<string, boolean>>({})
  let errors = $state<Record<string, string>>({})

  function newAccountPath(c: MalformedFxSpend, postingId: string): string | null {
    const after = c.after.find((p) => p.id === postingId)
    const before = c.before.find((p) => p.id === postingId)
    if (!after || !before || after.accountPath === before.accountPath) return null
    return after.accountPath
  }

  function amountClass(amount: string): string {
    return parseFloat(amount) < 0 ? 'neg' : 'pos'
  }

  async function fix(c: MalformedFxSpend) {
    healing = { ...healing, [c.transactionId]: true }
    errors = { ...errors, [c.transactionId]: '' }
    try {
      await healFxSpend(c.transactionId)
      onhealed?.(c.transactionId)
    } catch (e) {
      errors = {
        ...errors,
        [c.transactionId]: e instanceof Error ? e.message : 'Failed to repair',
      }
    } finally {
      healing = { ...healing, [c.transactionId]: false }
    }
  }
</script>

<Modal bind:open title="Repair imported transactions">
  <div class="intro">
    These cross-currency purchases were imported with the spend booked against the wrong
    accounts — the expense was reused as the conversion bridge and the money landed in a
    holding account it never really sat in. Repairing routes the conversion through
    <code>equity:conversions</code> and books the spend correctly. Amounts don't change.
  </div>

  {#if !conversionAccountConfigured}
    <div class="warn">
      No conversion account is configured. Set a default conversion account in
      <strong>Settings</strong> before repairing.
    </div>
  {/if}

  {#if candidates.length === 0}
    <p class="empty">Nothing to repair. 🎉</p>
  {/if}

  <ul class="list">
    {#each candidates as c (c.transactionId)}
      <li class="card">
        <div class="head">
          <span class="date">{c.date.slice(0, 10)}</span>
          <span class="desc">{c.description ?? '—'}</span>
        </div>

        <div class="postings">
          {#each c.before as p (p.id)}
            {@const moved = newAccountPath(c, p.id)}
            <div class="row" class:changed={moved !== null}>
              <span class="account">
                {#if moved}
                  <span class="old">{p.accountPath}</span>
                  <span class="arrow">→</span>
                  <span class="new">{moved}</span>
                {:else}
                  {p.accountPath}
                {/if}
              </span>
              <span class="amount {amountClass(p.amount)}">{p.amount}</span>
              <span class="ccy">{p.currency}</span>
            </div>
          {/each}
        </div>

        {#if errors[c.transactionId]}
          <div class="error">{errors[c.transactionId]}</div>
        {/if}

        <div class="actions">
          <GradientButton
            onclick={() => fix(c)}
            disabled={!c.canHeal || healing[c.transactionId]}
          >
            {healing[c.transactionId] ? 'Repairing…' : 'Repair this transaction'}
          </GradientButton>
        </div>
      </li>
    {/each}
  </ul>
</Modal>

<style>
  .intro {
    max-width: 460px;
    line-height: 1.4;
    margin-bottom: var(--sp-sm);
    color: var(--color-text-muted, var(--color-text));
  }

  code {
    font-family: var(--font-mono);
    background: var(--color-window);
    padding: 0 2px;
  }

  .warn {
    background: var(--color-warning-light);
    color: var(--color-warning);
    border: 1px solid var(--color-warning);
    padding: var(--sp-xs) var(--sp-sm);
    margin-bottom: var(--sp-sm);
  }

  .empty {
    color: var(--color-text-muted, var(--color-text));
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    max-height: 60vh;
    overflow-y: auto;
  }

  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border-color);
    border-radius: var(--card-radius);
    box-shadow: var(--card-shadow);
    padding: var(--sp-sm);
  }

  .head {
    display: flex;
    gap: var(--sp-sm);
    align-items: baseline;
    margin-bottom: var(--sp-xs);
  }

  .date {
    font-family: var(--font-mono);
    color: var(--color-text-muted, var(--color-text));
  }

  .desc {
    font-weight: var(--weight-semibold);
  }

  .postings {
    display: flex;
    flex-direction: column;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: var(--sp-sm);
    padding: 1px 0;
    align-items: baseline;
  }

  .row.changed {
    background: var(--color-accent-light);
  }

  .arrow {
    color: var(--color-accent);
    margin: 0 2px;
  }

  .old {
    text-decoration: line-through;
    color: var(--color-text-muted, var(--color-text));
  }

  .new {
    color: var(--color-accent);
    font-weight: var(--weight-semibold);
  }

  .amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .amount.pos {
    color: var(--color-amount-positive);
  }

  .amount.neg {
    color: var(--color-amount-negative);
  }

  .ccy {
    color: var(--color-text-muted, var(--color-text));
  }

  .error {
    color: var(--color-danger);
    margin-top: var(--sp-xs);
  }

  .actions {
    margin-top: var(--sp-sm);
    display: flex;
    justify-content: flex-end;
  }
</style>
