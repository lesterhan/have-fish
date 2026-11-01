<script lang="ts">
  import { onMount } from 'svelte'
  import type { ListedTransaction } from '../shared/commands'
  import { type Field, fieldOf, wordsFor } from './copy/errors'
  import { amountsText } from './format'

  let amount = $state('')
  let description = $state('')
  let error = $state<{ field: Field; words: string } | null>(null)
  let saving = $state(false)
  let transactions = $state<ListedTransaction[]>([])
  let amountInput: HTMLInputElement

  async function refresh() {
    const listed = await window.haveFish.invoke('transaction.list', {})
    if (listed.ok) transactions = listed.value
    else error = { field: 'form', words: wordsFor(listed) }
  }

  // Main says when a batch changed the ledger; the list asks again rather than guessing.
  onMount(() => {
    amountInput.focus()
    void refresh()
    return window.haveFish.onChanged(() => void refresh())
  })

  async function save(event: SubmitEvent) {
    event.preventDefault()
    if (saving) return
    saving = true
    const written = await window.haveFish.invoke('spend.write', { amount, description })
    saving = false
    if (written.ok) {
      amount = ''
      description = ''
      error = null
    } else {
      error = { field: fieldOf(written), words: wordsFor(written) }
    }
    amountInput.focus()
  }
</script>

<main>
  <form onsubmit={save} novalidate>
    <label>
      <span>Amount</span>
      <input
        bind:this={amountInput}
        bind:value={amount}
        name="amount"
        inputmode="decimal"
        autocomplete="off"
        maxlength="64"
        aria-invalid={error?.field === 'amount'}
        aria-describedby={error?.field === 'amount' ? 'amount-error' : undefined}
      />
    </label>
    {#if error?.field === 'amount'}
      <p class="error" id="amount-error" role="alert">{error.words}</p>
    {/if}

    <label>
      <span>What for</span>
      <input
        bind:value={description}
        name="description"
        autocomplete="off"
        maxlength="500"
        aria-invalid={error?.field === 'description'}
        aria-describedby={error?.field === 'description' ? 'description-error' : undefined}
      />
    </label>
    {#if error?.field === 'description'}
      <p class="error" id="description-error" role="alert">{error.words}</p>
    {/if}

    <button type="submit" disabled={saving}>Write it down</button>
    {#if error?.field === 'form'}
      <p class="error" role="alert">{error.words}</p>
    {/if}
  </form>

  <ol aria-label="Spends">
    {#each transactions as t (t.id)}
      <li>
        <span class="date">{t.date}</span>
        <span class="description">{t.description || '—'}</span>
        <span class="amount">{amountsText(t.amounts)}</span>
      </li>
    {/each}
  </ol>
</main>

<style>
  main {
    max-width: 40rem;
    margin: 0 auto;
    padding: var(--space-4);
  }

  form {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-6);
  }

  label {
    display: grid;
    gap: var(--space-1);
  }

  label span {
    font-size: var(--font-size-small);
    color: var(--color-muted);
  }

  input,
  button {
    font: inherit;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius);
    color: inherit;
    background: transparent;
  }

  input[aria-invalid='true'] {
    border-color: var(--color-error);
  }

  button {
    justify-self: start;
    cursor: pointer;
  }

  .error {
    margin: 0;
    font-size: var(--font-size-small);
    color: var(--color-error);
  }

  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: var(--border-width) solid var(--color-rule);
  }

  .date {
    color: var(--color-muted);
    font-variant-numeric: tabular-nums;
  }

  .amount {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
</style>
